import { getAlertDisplayItem, parseStoredAlertTypes, sortAlertTypes } from '../alertDisplay';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

void (async () => {
  await test('parses stored JSON alert arrays without exposing JSON syntax', () => {
    const alerts = parseStoredAlertTypes('["Severe Thunderstorm Watch","Heat Advisory"]');
    equal(alerts.length, 2, 'alert count');
    equal(alerts[0], 'Severe Thunderstorm Watch', 'first alert');
    equal(alerts[1], 'Heat Advisory', 'second alert');
  });

  await test('preserves plain-text legacy alerts', () => {
    const alerts = parseStoredAlertTypes('Heat Advisory');
    equal(alerts.length, 1, 'legacy alert count');
    equal(alerts[0], 'Heat Advisory', 'legacy alert text');
  });

  await test('deduplicates active alerts and prioritizes warnings over watches and advisories', () => {
    const items = sortAlertTypes([
      'Heat Advisory',
      'Severe Thunderstorm Watch',
      'Tornado Warning',
      'Heat Advisory',
    ]);
    equal(items.length, 3, 'deduplicated count');
    equal(items[0].event, 'Tornado Warning', 'highest priority alert');
    equal(items[1].event, 'Severe Thunderstorm Watch', 'watch priority');
    equal(items[2].event, 'Heat Advisory', 'advisory priority');
  });

  await test('assigns tornado warning critical presentation', () => {
    equal(getAlertDisplayItem('Tornado Warning').tone, 'critical', 'tornado warning tone');
  });

  console.log(`\nAlert display tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
