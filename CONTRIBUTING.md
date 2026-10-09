# Contributing

Add an item under `items/<kind>/<slug>/` following [SCHEMA.md](SCHEMA.md).
Include every payload file in manifest.json. Never submit credentials.
Open a pull request with a short description and state that you own or have
permission to share the files under the MIT license. You keep author credit.

Run `python tools/validate.py` and `python -m unittest discover -s tests -v`.
The PR check validates changed items. Maintainers review code, instructions
and server destinations before merging. Only merged items enter the catalog.
For updates, change the version and open another PR. Publishing directly
from Kairos is planned for Phase 2; Phase 1 submissions use ordinary PRs.

Flag a problem in an issue without posting secrets. Maintainers can list an
item in revoked.json with a reason; Kairos turns affected installs off.
