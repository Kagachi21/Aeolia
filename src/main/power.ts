/* koffi ships as CommonJS; requiring it keeps the build free of type friction. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const koffi = require('koffi') as any;

const kernel32 = koffi.load('kernel32.dll');

// SYSTEM_POWER_STATUS: 4 bytes followed by two DWORDs, 12 bytes total.
const PowerStatus = koffi.struct('SYSTEM_POWER_STATUS', {
  ACLineStatus: 'uint8',
  BatteryFlag: 'uint8',
  BatteryLifePercent: 'uint8',
  SystemStatusFlag: 'uint8',
  BatteryLifeTime: 'uint32',
  BatteryFullLifeTime: 'uint32',
});

const GetSystemPowerStatus = kernel32.func('bool GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS *status)');

export type PowerInfo = { charging: boolean; percent: number };

export function readPower(): PowerInfo {
  const status = {
    ACLineStatus: 0,
    BatteryFlag: 0,
    BatteryLifePercent: 0,
    SystemStatusFlag: 0,
    BatteryLifeTime: 0,
    BatteryFullLifeTime: 0,
  };
  try {
    if (!GetSystemPowerStatus(status)) return { charging: true, percent: 255 };
  } catch {
    return { charging: true, percent: 255 };
  }
  // 255 means "unknown / no battery" (typical on a desktop).
  const percent = status.BatteryLifePercent;
  return { charging: status.ACLineStatus === 1, percent };
}
