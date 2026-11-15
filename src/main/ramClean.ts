/* Memory tidy + usage statistics, straight from Win32 via koffi. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const koffi = require('koffi') as any;

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const psapi = koffi.load('psapi.dll');

koffi.struct('MEMORYSTATUSEX', {
  dwLength: 'uint32',
  dwMemoryLoad: 'uint32',
  ullTotalPhys: 'uint64',
  ullAvailPhys: 'uint64',
  ullTotalPageFile: 'uint64',
  ullAvailPageFile: 'uint64',
  ullTotalVirtual: 'uint64',
  ullAvailVirtual: 'uint64',
  ullAvailExtendedVirtual: 'uint64',
});
koffi.struct('FILETIME', { dwLowDateTime: 'uint32', dwHighDateTime: 'uint32' });

const GlobalMemoryStatusEx = kernel32.func('bool GlobalMemoryStatusEx(_Inout_ MEMORYSTATUSEX *buf)');
const GetSystemTimes = kernel32.func('bool GetSystemTimes(_Out_ FILETIME *idle, _Out_ FILETIME *kernel, _Out_ FILETIME *user)');
const EnumProcesses = psapi.func('bool EnumProcesses(_Out_ uint32 *pids, uint32 cb, _Out_ uint32 *needed)');
const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const EmptyWorkingSet = psapi.func('bool EmptyWorkingSet(void *hProcess)');
const CloseHandle = kernel32.func('bool CloseHandle(void *h)');

const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_QUERY_INFORMATION = 0x0400;

export type MemoryInfo = { totalMb: number; usedMb: number; percent: number };

export function memoryInfo(): MemoryInfo {
  const buf = koffi.struct ? koffi.alloc('MEMORYSTATUSEX', 1) : null;
  if (!buf) return { totalMb: 0, usedMb: 0, percent: 0 };
  koffi.encode(buf, 'MEMORYSTATUSEX', { dwLength: 64 });
  if (!GlobalMemoryStatusEx(buf)) return { totalMb: 0, usedMb: 0, percent: 0 };
  const st = koffi.decode(buf, 'MEMORYSTATUSEX');
  const totalMb = Math.round(Number(st.ullTotalPhys) / 1048576);
  const usedMb = Math.round((Number(st.ullTotalPhys) - Number(st.ullAvailPhys)) / 1048576);
  return { totalMb, usedMb, percent: Math.round(st.dwMemoryLoad) };
}

let lastSample: { idle: number; total: number; at: number } | null = null;

function systemTimes(): { idle: number; total: number } {
  const idle = koffi.alloc('FILETIME', 1);
  const kernel = koffi.alloc('FILETIME', 1);
  const user = koffi.alloc('FILETIME', 1);
  if (!GetSystemTimes(idle, kernel, user)) return { idle: 0, total: 0 };
  const read = (buf: unknown) => {
    const v = koffi.decode(buf, 'FILETIME') as { dwLowDateTime: number; dwHighDateTime: number };
    return Number(v.dwHighDateTime) * 4294967296 + Number(v.dwLowDateTime);
  };
  return { idle: read(idle), total: read(kernel) + read(user) };
}

/** CPU percent since the previous call; the first call seeds the baseline. */
export function cpuPercent(): number {
  const now = systemTimes();
  if (!lastSample || lastSample.total === 0) {
    lastSample = { ...now, at: Date.now() };
    return -1;
  }
  const dt = now.total - lastSample.total;
  const di = now.idle - lastSample.idle;
  lastSample = { ...now, at: Date.now() };
  if (dt <= 0) return -1;
  return Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
}

export type CleanResult = {
  freedMb: number;
  trimmed: number;
  denied: number;
  before: MemoryInfo;
  after: MemoryInfo;
};

/**
 * Trims the working set of every process, ours excluded. Nothing is killed and
 * nothing is written outside the process list.
 */
export function cleanRam(): CleanResult {
  const before = memoryInfo();

  const pids = koffi.alloc('uint32', 4096);
  const needed = koffi.alloc('uint32', 1);
  koffi.encode(needed, 'uint32', 0);
  if (!EnumProcesses(pids, 4096 * 4, needed)) {
    return { freedMb: 0, trimmed: 0, denied: 0, before, after: before };
  }
  const count = Math.min(4096, (koffi.decode(needed, 'uint32') as number) / 4);
  const list = koffi.decode(pids, 'uint32 *', count) as number[];

  let trimmed = 0;
  let denied = 0;
  for (const pid of list) {
    if (!pid || pid <= 4 || pid === process.pid) continue;
    const handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid);
    if (!handle) { denied += 1; continue; }
    try {
      if (EmptyWorkingSet(handle)) trimmed += 1; else denied += 1;
    } finally {
      CloseHandle(handle);
    }
  }

  const after = memoryInfo();
  return { freedMb: Math.max(0, after.usedMb < before.usedMb ? before.usedMb - after.usedMb : 0), trimmed, denied, before, after };
}
