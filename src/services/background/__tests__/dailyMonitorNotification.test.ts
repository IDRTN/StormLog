// Tests for Daily Monitor collection notification formatting
// Tests the notifyWeatherCollected formatting logic and edge cases

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = 'values differ') {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), `${message}: expected "${haystack}" to contain "${needle}"`);
}

async function test(name: string, task: () => Promise<void> | void) {
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

// Mirrors the formatting logic from notifyWeatherCollected
function formatNotificationBody(
  temp: number | null,
  condition: string | null,
  collectionTimeMs?: number
): { title: string; body: string; channelId: string } {
  const time = collectionTimeMs != null
    ? new Date(collectionTimeMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const t = temp != null ? `${Math.round(temp)}°F` : 'Temp unavailable';
  const c = condition || 'Conditions unavailable';
  return {
    title: 'StormLog — Daily Monitor',
    body: `${time} · ${t} · ${c}`,
    channelId: 'weather',
  };
}

void (async function main() {
  // === Title tests ===
  await test('title is exactly "StormLog — Daily Monitor"', async () => {
    const { title } = formatNotificationBody(72, 'Clear');
    assertEqual(title, 'StormLog — Daily Monitor', 'title');
  });

  // === Channel tests ===
  await test('uses weather channel', async () => {
    const { channelId } = formatNotificationBody(72, 'Clear');
    assertEqual(channelId, 'weather', 'channel');
  });

  // === Time formatting tests ===
  await test('notification contains the actual collection time', async () => {
    const collectionTimeMs = new Date(2024, 0, 15, 22, 15, 0).getTime(); // 10:15 PM
    const { body } = formatNotificationBody(72, 'Clear', collectionTimeMs);
    assertIncludes(body, '10:15 PM', 'body contains collection time');
  });

  await test('notification uses current time when no collection time provided', async () => {
    const before = Date.now();
    const { body } = formatNotificationBody(72, 'Clear');
    const after = Date.now();
    // The body should contain a time string (just check it has a colon for HH:MM format)
    assert(body.includes('·'), 'body contains separator');
    // Verify the time part is present by checking format
    const timePart = body.split('·')[0].trim();
    assert(timePart.match(/\d{1,2}:\d{2}\s?(AM|PM)/i) != null, `time part "${timePart}" matches time format`);
  });

  // === Temperature formatting tests ===
  await test('valid temperature is included', async () => {
    const { body } = formatNotificationBody(72, 'Clear', Date.now());
    assertIncludes(body, '72°F', 'body contains temperature');
  });

  await test('temperature rounds to nearest integer', async () => {
    const { body } = formatNotificationBody(72.6, 'Clear', Date.now());
    assertIncludes(body, '73°F', 'body contains rounded temperature');
  });

  await test('negative temperature works', async () => {
    const { body } = formatNotificationBody(-5, 'Snow', Date.now());
    assertIncludes(body, '-5°F', 'body contains negative temperature');
  });

  await test('null temperature shows fallback text', async () => {
    const { body } = formatNotificationBody(null, 'Clear', Date.now());
    assertIncludes(body, 'Temp unavailable', 'null temperature shows fallback');
    assert(!body.includes('null'), 'body does not contain literal "null"');
  });

  // === Condition formatting tests ===
  await test('valid condition is included', async () => {
    const { body } = formatNotificationBody(72, 'Clear', Date.now());
    assertIncludes(body, 'Clear', 'body contains condition');
  });

  await test('multi-word condition works', async () => {
    const { body } = formatNotificationBody(72, 'Partly Cloudy', Date.now());
    assertIncludes(body, 'Partly Cloudy', 'body contains multi-word condition');
  });

  await test('null condition shows fallback text', async () => {
    const { body } = formatNotificationBody(72, null, Date.now());
    assertIncludes(body, 'Conditions unavailable', 'null condition shows fallback');
    assert(!body.includes('null'), 'body does not contain literal "null"');
  });

  await test('empty string condition shows fallback text', async () => {
    const { body } = formatNotificationBody(72, '', Date.now());
    assertIncludes(body, 'Conditions unavailable', 'empty condition shows fallback');
  });

  // === Full body format tests ===
  await test('full body matches expected format with all data', async () => {
    const collectionTimeMs = new Date(2024, 5, 20, 14, 30, 0).getTime(); // 2:30 PM
    const { body } = formatNotificationBody(85, 'Thunderstorm', collectionTimeMs);
    assertIncludes(body, '2:30 PM', 'body contains time');
    assertIncludes(body, '85°F', 'body contains temperature');
    assertIncludes(body, 'Thunderstorm', 'body contains condition');
    // Verify separator format
    assertIncludes(body, '·', 'body uses dot separator');
    const parts = body.split('·').map(p => p.trim());
    assertEqual(parts.length, 3, 'body has exactly 3 parts separated by dots');
  });

  await test('full body handles all nulls gracefully', async () => {
    const collectionTimeMs = new Date(2024, 5, 20, 14, 30, 0).getTime();
    const { body } = formatNotificationBody(null, null, collectionTimeMs);
    assertIncludes(body, '2:30 PM', 'body contains time');
    assertIncludes(body, 'Temp unavailable', 'body contains temp fallback');
    assertIncludes(body, 'Conditions unavailable', 'body contains condition fallback');
  });

  // === Multiple notification tests ===
  await test('multiple calls produce separate notification content', async () => {
    const time1 = new Date(2024, 5, 20, 10, 0, 0).getTime();
    const time2 = new Date(2024, 5, 20, 10, 15, 0).getTime();
    const notif1 = formatNotificationBody(72, 'Clear', time1);
    const notif2 = formatNotificationBody(74, 'Sunny', time2);
    // Each notification has unique content (different times, temps, conditions)
    assert(notif1.body !== notif2.body, 'different collection times produce different notification bodies');
  });

  // === Warning notification independence ===
  await test('notification does not contain warning data type', async () => {
    const { title, body } = formatNotificationBody(72, 'Clear', Date.now());
    assert(!title.includes('stormlog_warning'), 'title does not contain warning type');
    assert(!body.includes('stormlog_warning'), 'body does not contain warning type');
    assert(!title.includes('Tornado'), 'title does not contain warning event');
    assert(!title.includes('Warning'), 'title does not contain warning text');
  });

  // === Edge cases ===
  await test('zero temperature is displayed', async () => {
    const { body } = formatNotificationBody(0, 'Clear', Date.now());
    assertIncludes(body, '0°F', 'zero temperature is displayed');
  });

  await test('very high temperature works', async () => {
    const { body } = formatNotificationBody(115, 'Extreme Heat', Date.now());
    assertIncludes(body, '115°F', 'high temperature works');
  });

  console.log(`\nDaily monitor notification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
