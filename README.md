# Time Album (Shelby) – custodial wallet publisher

Public, time-based photo album generator and publisher. Users upload photos, the
publisher organizes them by date, generates `index.json` and `index.html`, then
uploads the album to Shelby using the `shelby` CLI.

## Architecture
- `apps/web`: Next.js App Router UI + `/api/publish` proxy
- `services/publisher`: Node.js + Express + busboy upload service

## How it works
1. User selects photos in the web UI.
2. The web app posts a multipart upload to `/api/publish`.
3. The Next.js route proxies the multipart payload to the publisher.
4. The publisher organizes files by date, generates `index.json` + `index.html`,
   then runs:

```
shelby upload -r <dist_dir> <dst_prefix/> -e <expiration> --assume-yes
```

5. The publisher returns public URLs using Shelby REST:
   `GET /shelby/v1/blobs/<account>/<blob-name>`.

## Setup
1. Install dependencies:
```
npm install
```

2. Create `.env` from `.env.example` at the repo root and update values:
```
cp .env.example .env
```

3. Run the publisher:
```
npm run dev:publisher
```

4. Run the web app:
```
npm run dev:web
```

## Notes
- The publisher reads the Shelby account from
  `${SHELBY_CONFIG_DIR}/.shelby/config.yaml`.
- No private keys or real Shelby config are included in this repository.
