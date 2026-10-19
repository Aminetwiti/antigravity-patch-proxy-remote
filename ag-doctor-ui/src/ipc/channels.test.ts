import { describe, it, expect } from 'vitest';
import { DOCTOR_IPC_CHANNELS } from './channels';

describe('ag-doctor-ui IPC Channels Registry', () => {
  it('defines all required core IPC channels', () => {
    expect(DOCTOR_IPC_CHANNELS.RUN).toBe('ag:run');
    expect(DOCTOR_IPC_CHANNELS.PROVIDERS_GET).toBe('ag:providers:get');
    expect(DOCTOR_IPC_CHANNELS.PROVIDERS_SAVE).toBe('ag:providers:save');
    expect(DOCTOR_IPC_CHANNELS.PROVIDERS_DELETE).toBe('ag:providers:delete');
    expect(DOCTOR_IPC_CHANNELS.PROXY_START).toBe('ag:proxy:start');
    expect(DOCTOR_IPC_CHANNELS.PROXY_STOP).toBe('ag:proxy:stop');
    expect(DOCTOR_IPC_CHANNELS.PROXY_STATUS).toBe('ag:proxy:status');
    expect(DOCTOR_IPC_CHANNELS.PROXY_START_STUB).toBe('ag:proxy:start-stub');
    expect(DOCTOR_IPC_CHANNELS.DETECT_INSTALLATION).toBe('ag:detect-installation');
    expect(DOCTOR_IPC_CHANNELS.STREAM_START).toBe('ag:stream:start');
    expect(DOCTOR_IPC_CHANNELS.GOOGLE_REPAIR_ADC).toBe('ag:google:repair-adc');
    expect(DOCTOR_IPC_CHANNELS.SYSTEM_RANDOMIZE_MACHINE_ID).toBe('ag:system:randomize-machine-id');
  });

  it('ensures all channel values are unique', () => {
    const values = Object.values(DOCTOR_IPC_CHANNELS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
