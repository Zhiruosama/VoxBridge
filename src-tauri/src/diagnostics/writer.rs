use super::Record;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
pub(super) const LIMIT: u64 = 1024 * 1024;
const FILES: [&str; 3] = [
    "diagnostics.jsonl",
    "diagnostics.1.jsonl",
    "diagnostics.2.jsonl",
];
fn directory(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink() || !m.is_dir()) {
        return Err("日志文件路径无效。".into());
    }
    fs::create_dir_all(path).map_err(|_| "无法创建日志文件夹。")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护日志文件夹。")?;
    }
    Ok(())
}
fn file(path: &Path, append: bool) -> Result<File, String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink() || !m.is_file()) {
        return Err("日志文件路径无效。".into());
    }
    let mut options = OpenOptions::new();
    options
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let output = options.open(path).map_err(|_| "无法写入诊断日志。")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        output
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "无法保护诊断日志。")?;
    }
    Ok(output)
}
pub(super) struct Writer {
    directory: PathBuf,
    output: Option<File>,
    size: u64,
}
impl Writer {
    pub fn open(path: &Path) -> Result<Self, String> {
        directory(path)?;
        let output = file(&path.join(FILES[0]), true)?;
        let size = output.metadata().map_err(|_| "无法读取日志状态。")?.len();
        Ok(Self {
            directory: path.into(),
            output: Some(output),
            size,
        })
    }
    pub fn append(&mut self, record: &Record) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(record).map_err(|_| "诊断日志格式无效。")?;
        bytes.push(b'\n');
        if self.size + bytes.len() as u64 > LIMIT || self.output.is_none() {
            self.output.take();
            let oldest = self.directory.join(FILES[2]);
            if oldest.exists() {
                fs::remove_file(oldest).map_err(|_| "日志轮转失败。")?;
            }
            for i in (1..FILES.len()).rev() {
                let source = self.directory.join(FILES[i - 1]);
                if source.exists() {
                    fs::rename(source, self.directory.join(FILES[i]))
                        .map_err(|_| "日志轮转失败。")?;
                }
            }
            self.output = Some(file(&self.directory.join(FILES[0]), false)?);
            self.size = 0;
        }
        let output = self.output.as_mut().ok_or("诊断日志不可用。")?;
        if output.write_all(&bytes).is_err() {
            self.size = output.metadata().map(|m| m.len()).unwrap_or(LIMIT);
            return Err("诊断日志写入失败。".into());
        }
        self.size += bytes.len() as u64;
        Ok(())
    }
    pub fn export(&mut self, dropped: u64) -> Result<PathBuf, String> {
        self.flush()?;
        export(&self.directory, dropped)
    }
    pub fn flush(&mut self) -> Result<(), String> {
        self.output
            .as_mut()
            .ok_or("诊断日志不可用。")?
            .flush()
            .map_err(|_| "诊断日志刷新失败。".into())
    }
}
pub(super) fn export(path: &Path, dropped: u64) -> Result<PathBuf, String> {
    let target = path.join("export");
    directory(&target)?;
    let mut output = file(&target.join("VoxBridge-diagnostics.jsonl"), false)?;
    let header = serde_json::json!({"schemaVersion":1,"kind":"export","timeUnixMs":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"droppedEvents":dropped});
    writeln!(output, "{header}").map_err(|_| "诊断日志导出失败。")?;
    for name in FILES.iter().rev() {
        let source = path.join(name);
        if !source.exists() {
            continue;
        }
        let metadata = fs::symlink_metadata(&source).map_err(|_| "诊断日志读取失败。")?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("日志文件路径无效。".into());
        }
        let input = File::open(source).map_err(|_| "诊断日志读取失败。")?;
        use std::io::Read;
        std::io::copy(&mut input.take(LIMIT), &mut output).map_err(|_| "诊断日志导出失败。")?;
    }
    output.flush().map_err(|_| "诊断日志导出失败。")?;
    Ok(target)
}
