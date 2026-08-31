# Phase 1 Daily Monitor Reliability Baseline

## Field evidence

Observed unattended 15-minute test sequence:

- 02:44
- 03:05
- 03:23
- 03:39
- 03:59
- 04:19
- 04:40
- 05:00
- 05:20
- Then no automatic collections until the app was opened at 11:14.

The observed cadence drifted to roughly 16–21 minutes and eventually stopped until foreground app interaction.

## Phase 1 acceptance target

- Automatic monitoring survives normal app backgrounding and headless process recreation.
- 5/10/15/30/60-minute settings share one authoritative coordinator.
- Successful automatic collections define cadence; late Android callbacks do not postpone the next due collection.
- Failed automatic collections can retry without suppressing monitoring for a full interval.
- Foreground location service acts as a wake/recovery heartbeat rather than the authoritative scheduler.
- Actual collection timestamps remain authoritative for data analysis.
- APK is not considered release-ready until TypeScript validation and the existing coordinator regression suite pass.

This file records the baseline only; it is not used by the application at runtime.
