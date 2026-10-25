# Utility System Specification

## 1. Scope

This specification defines small shared backend utility functions and shared enums that do not own a larger subsystem.

## 2. Numeric Clamp Helper

`clampInt(value, fallback, min, max)` SHALL:

1. Convert `value` with `Number(value)`.
2. Use the converted value when it is finite; otherwise use `fallback`.
3. Apply `Math.floor` to the finite value.
4. Clamp the floored value to the inclusive range `[min, max]`.
5. Return the clamped integer.

The helper does not reorder `min` and `max` when `min > max`.

## 3. UTF-8 Truncation Helper

`truncateUtf8(str, maxLength)` SHALL:

1. Iterate JavaScript UTF-16 code units from left to right.
2. Add byte length according to the code unit value: 1 byte for `<= 0x7f`, 2 bytes for `<= 0x7ff`, 3 bytes for `<= 0xffff`, and 4 bytes otherwise.
3. Stop before including the first code unit that would make the accumulated byte length greater than `maxLength`.
4. Return `str.slice(0, endIndex)`.

The helper approximates UTF-8 byte length by code unit and does not combine surrogate pairs before calculating length.

## 4. Random String Helper

`getRandomString(length)` SHALL:

1. Use the alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`.
2. Generate exactly `length` characters.
3. Use `Math.random()` for each character selection.

The helper is not cryptographically secure.

## 5. Tracking Event Enum

`TrackingEvent` SHALL define:

| Name           | Value          |
| -------------- | -------------- |
| `VIEW_ARTICLE` | `article_view` |

The tracking middleware SHALL only record recommendation behavior for `TrackingEvent.VIEW_ARTICLE`.

## 6. Workflow Data Source Enum

`WorkflowDataSource` SHALL define:

| Name      | Value     |
| --------- | --------- |
| `ARTICLE` | `article` |
| `PASTE`   | `paste`   |

The enum is a shared constant and has no runtime side effect.

## 7. File Locations

- Number helper: `packages/backend/src/utils/number.ts`
- String helpers: `packages/backend/src/utils/string.ts`
- Tracking event enum: `packages/backend/src/shared/event.ts`
- Workflow data source enum: `packages/backend/src/shared/workflow.ts`
