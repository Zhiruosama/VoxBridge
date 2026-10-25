//! Current-user DPAPI and a protected user/SYSTEM-only DACL. No UI or machine-wide key.
use std::{os::windows::ffi::OsStrExt, path::Path};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            Cryptography::{
                CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
            },
            GetTokenInformation, SetFileSecurityW, TokenUser, DACL_SECURITY_INFORMATION,
            PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, TOKEN_QUERY, TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    },
};
use zeroize::{Zeroize, Zeroizing};

pub(super) fn protect(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    crypt(bytes, true)
}
pub(super) fn unprotect(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    crypt(bytes, false)
}
fn crypt(bytes: &[u8], encrypt: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    if bytes.is_empty() || bytes.len() > 16_384 {
        return Err("本机加密密钥格式无效。".into());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| {
            "Windows 无法保护或解密本机密钥；原文件已保留，请使用原 Windows 用户登录。"
        })?;
        let memory = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let value = Zeroizing::new(memory.to_vec());
        memory.zeroize();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(value)
    }
}

pub(super) fn restrict(path: &Path) -> Result<(), String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|_| "无法读取 Windows 用户权限。")?;
        let mut needed = 0;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        let mut buffer = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
        let read = GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            needed,
            &mut needed,
        );
        let _ = CloseHandle(token);
        read.map_err(|_| "无法读取 Windows 用户标识。")?;
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid)
            .map_err(|_| "无法读取 Windows 用户标识。")?;
        let sid_text = sid.to_string().map_err(|_| "Windows 用户标识无效。");
        let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
        let sddl: Vec<u16> = format!("D:P(A;OICI;FA;;;{})(A;OICI;FA;;;SY)", sid_text?)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            1,
            &mut descriptor,
            None,
        )
        .map_err(|_| "无法创建 Windows 凭据权限。")?;
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let result = SetFileSecurityW(
            PCWSTR(path.as_ptr()),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
        .ok();
        let _ = LocalFree(Some(HLOCAL(descriptor.0)));
        result.map_err(|_| "无法保护 Windows 凭据目录或文件权限。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dpapi_roundtrip_rejects_corruption() {
        let plain = [42u8; 32];
        let mut encrypted = protect(&plain).unwrap();
        assert_ne!(&encrypted[..], &plain);
        assert_eq!(&unprotect(&encrypted).unwrap()[..], &plain);
        let last = encrypted.len() - 1;
        encrypted[last] ^= 1;
        assert!(unprotect(&encrypted).is_err());
    }
    #[test]
    fn directory_acl_is_protected_and_has_only_user_and_system_entries() {
        use windows::Win32::Security::{
            GetFileSecurityW, GetSecurityDescriptorControl, GetSecurityDescriptorDacl, ACL,
        };
        let directory = std::env::temp_dir().join(format!(
            "voxbridge-acl-{}",
            hex::encode(crate::credentials::crypto::random(8).unwrap())
        ));
        std::fs::create_dir(&directory).unwrap();
        restrict(&directory).unwrap();
        let path: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let mut size = 0;
            let _ = GetFileSecurityW(
                PCWSTR(path.as_ptr()),
                DACL_SECURITY_INFORMATION.0,
                None,
                0,
                &mut size,
            );
            let mut bytes = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
            let descriptor = PSECURITY_DESCRIPTOR(bytes.as_mut_ptr().cast());
            GetFileSecurityW(
                PCWSTR(path.as_ptr()),
                DACL_SECURITY_INFORMATION.0,
                Some(descriptor),
                size,
                &mut size,
            )
            .ok()
            .unwrap();
            let (mut control, mut revision) = (0, 0);
            GetSecurityDescriptorControl(descriptor, &mut control, &mut revision).unwrap();
            assert_ne!(control & 0x1000, 0); // SE_DACL_PROTECTED
            let mut present = windows::core::BOOL(0);
            let mut defaulted = windows::core::BOOL(0);
            let mut acl: *mut ACL = std::ptr::null_mut();
            GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted).unwrap();
            assert!(present.as_bool() && !acl.is_null());
            assert_eq!((*acl).AceCount, 2);
        }
        std::fs::remove_dir(directory).unwrap();
    }
}
