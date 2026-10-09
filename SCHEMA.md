# Store schema v1

Each item is one folder: `items/<kind>/<slug>/manifest.json` and its payload.
Kinds are `tab`, `skill`, `tool`, `automation`. Folders and files cannot be
symlinks, junctions or special files. Submissions are UTF-8 text only.

## Manifest

Required fields, with no other fields except the optional field below:

| Field | Rule |
| --- | --- |
| kind | One of the four kinds; matches the parent folder |
| slug | Matches `[a-z][a-z0-9_]{0,63}` and the folder name; routes, services and views are reserved |
| name | Nonempty string, at most 120 characters |
| description | Nonempty string, at most 2000 characters |
| author | GitHub login, up to 39 letters, digits or internal single hyphens |
| version | Semantic Versioning 2.0 version, including optional prerelease/build suffixes |
| license | Exactly `MIT` |
| min_kairos_version | Optional semver; Kairos refuses installs requiring a newer app |
| files | Nonempty list of all payload paths relative to the item folder; excludes manifest.json |

manifest.json is at most 16384 bytes. No unlisted files. Names are ASCII
letters, digits, underscores, dots or hyphens with `/` separating folders.
No absolute paths, empty segments, dot segments, backslashes, drive letters,
Windows device names, trailing dots/spaces, case-insensitive duplicates,
.git, __pycache__, or names starting with .env.

## Payloads and limits

**Tab:** tab.json and routes.py, with optional view.js, view.css, service.py,
hooks.py, package helpers and supporting text files. The archive passed to
Kairos is a ZIP with exactly one top-level `<slug>/` folder and these payload
files beneath it, excluding the store manifest. This is the folder source
exported by core/tab_install.py: core/tab_folders.code_files includes every
regular source file recursively, excluding __pycache__, and excludes separate
tab data. A visible tab also includes view.js; the local installer requires
only tab.json and routes.py. tab.json must contain
slug, name, version, description, positive integer api, and a list of string
hooks. Optional icon_svg, blurb, detail and reads are strings. Unknown tab.json
fields are inert, matching Kairos. Python imports follow core/tab_checks.py:
Kairos imports only through core.tab_api; intra-tab relative imports work.
Limits match the installer: 500 payload files, 20 MiB unpacked, 5 MiB ZIP.
Source approval remains separate from the install scan.

**Skill:** SKILL.md and optional supporting files. Kairos preserves frontmatter
and scans the complete bundle with the community Skills Guard policy before
writing it, then uses its usual curation and approval. SKILL.md is at most
100000 bytes, matching remote_skill_source.py. Guard structural limits are
enforced as hard store limits: 50 payload files, 5 MiB total, 256 KiB per file.
Optional .skillignore and .clawhubignore are accepted, but cannot hide
submitted content from the store or install scan.

For tabs and skills the text-extension allowlist is: .md, .txt, .py, .sh,
.bash, .js, .ts, .rb, .yaml, .yml, .json, .toml, .cfg, .ini, .conf, .html,
.css, .xml, .tex, .r, .jl, .pl, .php. Binary/control-byte content is refused.
This deliberately narrows the local tab export surface to reviewable text.

**Tool:** exactly server.json, at most 100000 bytes. Its only fields are name
(nonempty, up to 120 characters), url, transport (`http`, Kairos's HTTP MCP
transport) and auth_type (`none` or `oauth`). URL is HTTPS only, with no
credentials, query string or fragment; no port except 443. Tokens, header
values, commands, environment values and secrets are forbidden. Users sign
in locally for OAuth. The existing MCP add/check and tool acceptance apply.

**Automation:** exactly automation.json, at most 100000 bytes. Required
nonempty title and prompt strings, schedule object, optional nonempty
model_hint string. No IDs, delivery channel, endpoint ID, agent, built-in
action, trigger or executable action. Model hint is descriptive and does
not choose a local model. Schedule has exactly one of these shapes:

```json
{"schedule_kind": "once", "run_at": "2027-01-01T09:00:00-05:00"}
{"schedule_kind": "interval", "interval_seconds": 604800}
{"schedule_kind": "daily", "run_time": "09:00"}
```

run_at includes a timezone; interval_seconds is an integer from 1 through
31536000; run_time is HH:MM in the user's local time. These are the task
service's schedule fields. Work board cards are not scheduled templates.
Kairos creates the task turned off in its first write. The user chooses a
delivery channel and model in Tasks before turning it on.

All files are checked for common token formats, private keys and credential
assignments. All literal HTTP URLs are refused. Dangerous Guard scans fail
CI; caution findings are printed for maintainer review and still require
the local user's scan confirmation. A merged PR does not bypass local gates.

## Index and integrity

index.json has schema_version (integer 1), generated_from_commit (GITHUB_SHA,
--commit, or `local` for an offline build), and items. Each index entry has
kind, slug, name, description, author, version, path (`items/<kind>/<slug>`),
archive_sha256, and files (the manifest's payload list).
The catalog is capped at 1000 items and 2 MiB. revoked.json is also capped
at 2 MiB and 5000 entries.

archive_sha256 is lowercase SHA-256 of a deterministic byte stream, not of
ZIP container bytes. Include manifest.json and every listed payload file.
Sort their relative ASCII path strings in ascending order, case-sensitive.
For each path append, in order: path UTF-8 byte length as an unsigned 64-bit
big-endian integer, path UTF-8 bytes, file byte length as unsigned 64-bit
big-endian integer, then the exact file bytes. Concatenate all records and
hash that stream. Do not normalize whitespace or line endings. .gitattributes
uses LF so submitted text bytes agree with the raw files served by GitHub.
tools/store_schema.py and Kairos core/store_schema.py implement this contract.

The index job commits the generated file in a subsequent bot commit.
generated_from_commit describes the source input, so it can differ from
the catalog's download SHA. Kairos resolves main once per refresh and fetches
index.json, revoked.json and all item files at that immutable resolved SHA.

## Revocations

revoked.json has exactly `{"items": []}` or items of this shape:

```json
{"kind": "skill", "slug": "meeting_summary", "versions": ["1.0.0"], "reason": "Instructions are under review."}
```

versions is a nonempty semver list or the string `all`. Reason is a nonempty
string of at most 2000 characters. Kairos turns affected installs off and
records the reason even if the item disappeared from index.json. Explicit
confirmation can turn that exact installed version back on; changed
revocations require another confirmation. Remove is available locally.
