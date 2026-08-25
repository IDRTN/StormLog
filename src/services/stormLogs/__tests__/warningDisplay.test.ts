import { getWarningEventDisplay } from '../warningDisplay';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = 'values differ') {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function test(name: string, task: () => void | Promise<void>) {
  try {
    await task();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: ${name}`);
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventName: 'Field observation',
    endTime: null,
    isAutomatic: false,
    triggerSource: null,
    nwsAlertId: null,
    currentNwsAlertId: null,
    warningStatus: null,
    warningEndsAt: null,
    startTime: 100,
    ...overrides,
  };
}

async function main() {
  await test('manual events retain the existing non-NWS presentation', () => {
    const display = getWarningEventDisplay(event());
    assertEqual(display.sourceLabel, null);
    assertEqual(display.warningType, null);
    assertEqual(display.lifecycleLabel, null);
    assertEqual(display.lifecycleTone, 'neutral');
    assertEqual(display.warningEndsAt, null);
  });

  await test('automatic tornado warning displays its NWS source and type', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Tornado Warning',
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
    }));
    assertEqual(display.sourceLabel, 'NWS · AUTOMATIC');
    assertEqual(display.warningType, 'Tornado Warning');
    assertEqual(display.lifecycleLabel, 'ACTIVE WARNING');
  });

  await test('automatic severe thunderstorm warning displays warning information', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Severe Thunderstorm Warning',
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
    }));
    assertEqual(display.warningType, 'Severe Thunderstorm Warning');
    assertEqual(display.lifecycleLabel, 'ACTIVE WARNING');
  });

  await test('automatic flash flood warning displays warning information', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Flash Flood Warning',
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
    }));
    assertEqual(display.warningType, 'Flash Flood Warning');
    assertEqual(display.lifecycleLabel, 'ACTIVE WARNING');
  });

  await test('active warnings expose an active state', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Tornado Warning',
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
      warningStatus: 'ACTIVE',
      warningEndsAt: 2500,
    }));
    assertEqual(display.lifecycleLabel, 'ACTIVE WARNING');
    assertEqual(display.lifecycleTone, 'active');
    assertEqual(display.warningEndsAt, 2500);
  });

  await test('canceled warnings expose a canceled state', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Tornado Warning',
      endTime: 2000,
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
      warningStatus: 'CANCELED',
    }));
    assertEqual(display.lifecycleLabel, 'CANCELED');
    assertEqual(display.lifecycleTone, 'canceled');
  });

  await test('expired warnings expose an ended state', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Tornado Warning',
      endTime: 2000,
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
      warningStatus: 'EXPIRED',
    }));
    assertEqual(display.lifecycleLabel, 'EXPIRED');
    assertEqual(display.lifecycleTone, 'ended');
  });

  await test('closed warnings without lifecycle status fall back to ended', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Tornado Warning',
      endTime: 2000,
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
    }));
    assertEqual(display.lifecycleLabel, 'ENDED');
    assertEqual(display.lifecycleTone, 'ended');
  });

  await test('null automatic metadata falls back without fabricated expiration', () => {
    const display = getWarningEventDisplay(event({
      eventName: 'Automatic Tornado Warning',
      isAutomatic: true,
      triggerSource: null,
      warningStatus: null,
      warningEndsAt: null,
    }));
    assertEqual(display.sourceLabel, 'AUTOMATIC');
    assertEqual(display.lifecycleLabel, 'ACTIVE WARNING');
    assertEqual(display.warningEndsAt, null);
  });

  await test('display interpretation does not mutate the Storm Event', () => {
    const original = event({
      eventName: 'Automatic Tornado Warning',
      isAutomatic: true,
      triggerSource: 'NWS_WARNING',
      warningStatus: 'CANCELED',
      warningEndsAt: 3000,
    });
    const snapshot = JSON.stringify(original);
    getWarningEventDisplay(original);
    assertEqual(JSON.stringify(original), snapshot);
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
