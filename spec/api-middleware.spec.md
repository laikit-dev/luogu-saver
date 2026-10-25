# API Middleware Specification

## 1. Overview

The API middleware subsystem applies HTTP request preprocessing and postprocessing before route handlers execute.

## 2. Access Logging

For every HTTP request, after authorization middleware has completed, the system SHALL write exactly one info-level log entry.

The client IP address SHALL be Koa `ctx.ip`.

The Koa application SHALL be constructed with `proxy=true` and `proxyIpHeader='CF-Connecting-IP'`. Therefore `ctx.ip` MAY be derived from request header `CF-Connecting-IP` when Koa accepts that header.

The access log entry SHALL include:

1. Client IP address as `ip`.
2. Authenticated user ID as `userId` if authentication succeeded; otherwise `null`.
3. HTTP method as `method`.
4. Request path as `path`.
5. HTTP response status as `status`.

The access log entry SHALL NOT include request body, response body, authorization header, cookie header, or query parameter values.

## 3. API Rate Limiting

If `config.apiRateLimit.enabled` is `true`, every HTTP request SHALL be checked by a Redis-backed rate limiter before router execution.

The rate limit key SHALL be the client IP address resolved by the rule set in section 2.

If the request is within the configured limit, request processing SHALL continue.

If the request exceeds the configured limit, the server SHALL return HTTP 200 with response body `{ code: 429, message: 'Too Many Requests', data: null }`.

The rate limiter SHALL NOT read or store the request body.

## 4. Middleware Order

The middleware order SHALL satisfy these constraints:

1. Access log middleware SHALL wrap the HTTP middleware chain and write the log entry after downstream middleware returns or is handled by response helper middleware.
2. Response helper middleware SHALL execute before API rate limiting.
3. Authorization middleware SHALL execute before the access log entry is written.
4. API rate limiting SHALL execute before request body parsing.
5. Route handlers SHALL execute after response helper, authorization, API rate limiting, and request body parsing.

## 5. Response Helper

`ctx.fail(code, message, data?)` SHALL return HTTP 200 with body `{ code, message, data }`.

The returned `message` SHALL be normalized by `task-queue.spec.md` failure reason normalization and have length at most 80 characters.

## 6. Tracking Middleware

The tracking middleware SHALL execute after request body parsing and before router execution.

For each request:

1. The middleware SHALL compute `subject = resolveRecommendationSubject(ctx)` as defined in `recommendation-system.spec.md` section 3.1. Authorization middleware has already set `ctx.user` for a valid bearer token.
2. If `subject` is `null`, the middleware SHALL NOT attach `ctx.track`.
3. If `subject` is non-null, the middleware SHALL attach `ctx.track(event, data)`.
4. `ctx.track(TrackingEvent.VIEW_ARTICLE, articleId)` with a non-empty `articleId` SHALL call `RecommendationService.recordBehavior(subject, articleId)`.
5. `ctx.track` SHALL ignore every other event and an empty `articleId`.

Therefore an authenticated request with `X-Consent-Tracking: true` records behavior for the user subject and never writes the `X-Device-Id` device key.

## 7. File Locations

- Entry point: `packages/backend/src/index.ts`
- Client IP helper: `packages/backend/src/middlewares/client-ip.ts`
- Access log middleware: `packages/backend/src/middlewares/access-log.ts`
- API rate limit middleware: `packages/backend/src/middlewares/api-rate-limit.ts`
- Response helper middleware: `packages/backend/src/middlewares/response.ts`
- Authorization middleware: `packages/backend/src/middlewares/authorization.ts`
- Tracking middleware: `packages/backend/src/middlewares/tracking.ts`
