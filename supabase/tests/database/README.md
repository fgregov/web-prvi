# Database tests

pgTAP tests, run with `pnpm db:test` (wraps `supabase test db`). Each file runs
in its own transaction and is rolled back, so tests never leak data.

Every file inlines the same small fixture block (two tenants, four users)
because `supabase test db` executes files independently. Fixed UUIDs:

| user  | id prefix  | membership              |
|-------|------------|-------------------------|
| Alice | `a1…`      | Org A · owner           |
| Dave  | `d4…`      | Org A · admin           |
| Carol | `c3…`      | Org A · sales           |
| Bob   | `b2…`      | Org B · owner           |

Switching identity: `select pg_temp.login_as('<uuid>')` then `reset role` to
return to the superuser before switching to someone else.
