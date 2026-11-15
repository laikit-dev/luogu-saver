# Article Discovery Retirement Specification

## 1. Scope

User article discovery is removed. The backend SHALL NOT crawl a Luogu user's article list to
create article save workflows, whether requested by a user or triggered by a schedule.

This removal SHALL NOT remove manual saving or refreshing of an individual article or user
profile, public user archives, profile or article history, RSS, ordinary full-text search,
recommendations, or the embeddings used by recommendations.

## 2. REST API

The backend SHALL NOT register a discovery router or any of these former routes:

- `POST /discover/user/:uid/articles/start`
- `GET /discover/runs`
- `GET /discover/runs/:id`
- `POST /discover/runs/:id/stop`

Requests to these paths SHALL use the backend's ordinary unmatched-route behavior. The backend
SHALL NOT provide replacement discovery endpoints, compatibility aliases, or discovery run APIs.

## 3. Tasks and Scheduling

The backend SHALL NOT define or dispatch the `discover` task type or the
`discover:user_articles` handler. It SHALL NOT create a discovery queue, worker, processor, or
periodic discovery scheduler.

Fetching or saving an individual article SHALL NOT enqueue a crawl of its author's article
list or recursively discover other articles from its content.

Existing article save workflows SHALL remain available to their non-discovery callers.

## 4. Persistence

The backend SHALL NOT register `DiscoveryRun` or `DiscoveredArticle` as ORM entities. Runtime
code SHALL NOT create, list, update, or broadcast discovery runs or discovered article records.

The removed discovery subsystem SHALL NOT delete saved articles, profiles, history records,
or recommendation embeddings.

## 5. WebSocket API

The backend SHALL NOT register a discovery room authorization rule, join hook, or broadcaster
for `discovery:runs`. It SHALL NOT emit `discovery:runs:update` or replay an initial discovery
run snapshot.

The existing treatment of unknown room names SHALL remain unchanged. An accepted generic room
join using the former room name SHALL NOT return discovery data or install discovery handlers.

## 6. Frontend and Permissions

The frontend SHALL NOT register `/discovery/user-articles`, render its former UID crawl form,
or display a user article discovery navigation item.

The administration interface SHALL NOT display discovery runs, discovery subscription state,
or a discovery stop action. Frontend API clients SHALL NOT call discovery endpoints or
subscribe to discovery rooms or events.

The backend and frontend permission definitions SHALL NOT expose `MANAGE_DISCOVERY`.
