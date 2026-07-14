# ADR 0008: Remove the native mobile application

- Status: Accepted
- Date: 2026-07-14
- Scope: Phase 0 of the API V2 hardening program

## Context

EduSmart is focusing this release on the React web application/PWA, Laravel,
PostgreSQL, Redis, workers, the scheduler, object storage, and RFID/device web
integrations. The separate React Native/Expo application duplicated auth,
attendance, quiz, and RFID flows and required Android/iOS release pipelines
that will not be operated in this phase.

The repository also contains web features whose names refer to small screens or
phones. These are part of the web product and are not the native application.

## Decision

Remove the `mobile-app` package, Android/iOS workflows, native-only API routes,
native Google OAuth exchange, native-only tests, and native documentation.

Retain the following web capabilities:

- the Vite PWA plugin, manifest, and service-worker registration;
- responsive layouts and web navigation for narrow screens;
- browser NFC/camera behavior;
- Laravel RFID/device endpoints, MQTT integration, and ESP8266 firmware;
- secure API-token management for integrations that are not the removed app.

Quiz access is now web-only. The existing `access_device` database column is
kept temporarily so Phase 0 does not perform a destructive schema migration or
discard historical records. Runtime normalization treats legacy values as web
access, and new writes store `web`.

## Consequences

- Native APK/IPA builds and native deep-link login are no longer supported.
- Existing native clients lose their dedicated endpoints when this change is
  deployed; deployment notes must call this out as an intentional breaking
  product decision.
- PWA and responsive web behavior remain supported.
- Removing the compatibility column can be considered later only with a
  reversible migration, backup, and evidence that no active consumer uses it.
