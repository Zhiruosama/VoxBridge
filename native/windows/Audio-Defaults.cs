// Core Audio inventory uses the Windows SDK contracts. The compatibility setter
// is the IPolicyConfig interface also used by EarTrumpet; never use it to select
// VB-CABLE, only to undo an installer replacing a previously selected endpoint.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace VoxBridge.DriverSetup {
    public class Endpoint {
        public int Flow;
        public int Role;
        public string Id;
        public bool Active;
        public bool Cable;
    }
    public class RestoreResult {
        public int Restored;
        public int Failed;
    }
    public static class AudioDefaults {
        public static bool IsCable(string friendly, string description, string audioInterface) {
            const string vendor = "VB-Audio Virtual Cable";
            return String.Equals(description, vendor, StringComparison.OrdinalIgnoreCase)
                || String.Equals(audioInterface, vendor, StringComparison.OrdinalIgnoreCase)
                || ((friendly ?? "").EndsWith("(" + vendor + ")", StringComparison.OrdinalIgnoreCase)
                    && ((friendly ?? "").StartsWith("CABLE ", StringComparison.OrdinalIgnoreCase)
                        || (friendly ?? "").StartsWith("VoxBridge (", StringComparison.OrdinalIgnoreCase)));
        }
        public static bool ShouldRestore(Endpoint before, Endpoint current, Endpoint available) {
            return before != null && current != null && available != null
                && before.Flow >= 0 && before.Flow <= 1 && before.Role >= 0 && before.Role <= 2
                && !before.Cable && current.Cable && current.Active && available.Active && !available.Cable
                && before.Flow == current.Flow && before.Role == current.Role && before.Flow == available.Flow
                && !String.IsNullOrEmpty(before.Id) && before.Id == available.Id && before.Id != current.Id;
        }
        static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
        static IMMDeviceEnumerator Enumerator() {
            return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
        }
        static string Property(IPropertyStore store, string guid, uint id) {
            var key = new PropertyKey { Format = new Guid(guid), Id = id };
            PropVariant value;
            if (store.GetValue(ref key, out value) < 0) return "";
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : ""; }
            finally { PropVariantClear(ref value); }
        }
        static Endpoint Read(IMMDevice device, int role) {
            IPropertyStore store = null;
            try {
                string id; uint state; int flow;
                Marshal.ThrowExceptionForHR(device.GetId(out id));
                Marshal.ThrowExceptionForHR(device.GetState(out state));
                Marshal.ThrowExceptionForHR(((IMMEndpoint)device).GetDataFlow(out flow));
                Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
                string friendly = Property(store, "A45C254E-DF1C-4EFD-8020-67D146A850E0", 14);
                string description = Property(store, "A45C254E-DF1C-4EFD-8020-67D146A850E0", 2);
                string audioInterface = Property(store, "026E516E-B814-414B-83CD-856D6FEF4822", 2);
                return new Endpoint { Flow = flow, Role = role, Id = id, Active = (state & 1) != 0, Cable = IsCable(friendly, description, audioInterface) };
            } finally { Release(store); }
        }
        static Endpoint Current(IMMDeviceEnumerator enumerator, int flow, int role) {
            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(flow, role, out device);
            if (hr == unchecked((int)0x80070490)) return null; // no default endpoint
            Marshal.ThrowExceptionForHR(hr);
            try { return Read(device, role); } finally { Release(device); }
        }
        public static Endpoint[] Capture() {
            var result = new List<Endpoint>();
            var enumerator = Enumerator();
            try {
                for (int flow = 0; flow < 2; flow++) for (int role = 0; role < 3; role++) {
                    var endpoint = Current(enumerator, flow, role);
                    if (endpoint != null && endpoint.Active && !endpoint.Cable) result.Add(endpoint);
                }
                return result.ToArray();
            } finally { Release(enumerator); }
        }
        public static RestoreResult Restore(Endpoint[] before) {
            var result = new RestoreResult();
            var enumerator = Enumerator();
            IPolicyConfig policy = null;
            try {
                foreach (var saved in before) {
                    if (saved == null || saved.Flow < 0 || saved.Flow > 1 || saved.Role < 0 || saved.Role > 2 || String.IsNullOrEmpty(saved.Id) || saved.Id.Length > 4096) continue;
                    IMMDevice device = null;
                    try {
                        var current = Current(enumerator, saved.Flow, saved.Role);
                        if (current == null || !current.Cable || current.Id == saved.Id) continue;
                        if (enumerator.GetDevice(saved.Id, out device) < 0) continue;
                        var available = Read(device, saved.Role);
                        if (!ShouldRestore(saved, current, available)) continue;
                        if (policy == null) policy = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")));
                        // Respect a user's intervening selection of another device.
                        var latest = Current(enumerator, saved.Flow, saved.Role);
                        if (latest == null || latest.Id != current.Id) continue;
                        Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(saved.Id, saved.Role));
                        result.Restored++;
                    } catch { result.Failed++; }
                    finally { Release(device); }
                }
                return result;
            } finally { Release(policy); Release(enumerator); }
        }
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
    }
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activation, out IntPtr result);
        [PreserveSig] int OpenPropertyStore(uint access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [ComImport, Guid("1BE09788-6894-4089-8586-9A2A6C265AC5"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMEndpoint { [PreserveSig] int GetDataFlow(out int flow); }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig {
        void Reserved0(); void Reserved1(); void Reserved2(); void Reserved3();
        void Reserved4(); void Reserved5(); void Reserved6(); void Reserved7();
        void Reserved8(); void Reserved9();
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    }
}
