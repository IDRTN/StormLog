# StormLog Wear OS Companion

This directory contains the native Wear OS companion for StormLog.

## Safety architecture

The phone remains the authoritative compute/data source for radar, HRRR, lightning, NWS alerts, and StormLog tornado analysis. The watch displays a compact, timestamped safety snapshot and never upgrades missing/stale data into evidence.

Official NWS warning state is represented separately from StormLog's own tornado-development assessment.

## Phase 1 snapshot contract

The watch contract will carry:

- schema version and generated-at timestamp
- StormLog tornado assessment and confidence
- radar source/site, data age, quantitative/velocity/dual-pol availability
- rotation/couplet and gate-to-gate shear when available
- lightning status, nearest strike distance, and lightning data age
- official NWS warning status, event name, expiry, and identifier
- phone/watch synchronization age

The first implementation targets Wear OS / Galaxy Watch 6. Heavy Level II processing remains on the Android phone/backend to protect watch battery life and preserve the existing validated radar pipeline.
