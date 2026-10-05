# The two scripts in here

Both are **byte-for-byte copies** of the desktop project's `tools/`, and they are here so that a
deploy is one folder with nothing missing:

| File | What it does | When it runs |
|---|---|---|
| `web-config.js` | fills the Supabase project and the domain into `assets/js/config.js` and the pages, from the environment | as the Vercel **Build Command** (`vercel.json`), or `npm run web:config` |
| `serve-web.js` | serves this folder at `http://127.0.0.1:4173/` with the same clean URLs Vercel uses, so `/download` works locally | `npm run serve:web` |

Each one finds the site rather than assuming where it is — `web/` inside the desktop project, this
folder standing alone — so the copies stay identical and there is nothing to keep in step. Edit
them in the desktop project (`tools/web-config.js`, `tools/serve-web.js`) and copy the file over;
the site check there is what covers both (`npm run check:web` runs the real `web-config.js` against
a sandbox, and refuses a `web:config` script that does not point at it).

With no environment variables set, `web-config.js` prints what it reads and changes nothing, so it
is safe as a build step on a deploy that sets none of them.
