# Profile Label Design

## Goal

Make saved proxy profiles concise in the popup profile selector.

## Behavior

- An automatically migrated profile uses its proxy host as its name instead of `Default`.
- An existing migrated profile with `id: "default"` and `name: "Default"` is renamed to its host.
- Profile options display only the profile name.
- User-defined profile names remain unchanged.
- Proxy credentials, scheme, and port are not displayed in the selector.

## Verification

- Storage migration tests cover new and existing migrated profiles.
- A popup source test verifies that option labels use only the profile name.
- The full test, lint, format, and build checks pass.
