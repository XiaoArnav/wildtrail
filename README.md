# WildTrail

Collect real wildlife outdoors: animals, birds, insects and flowers. Point your camera, an open-source AI model on your phone suggests what it is, you confirm, and it goes into your collection. A map fills in as you walk and tracks how far you have travelled.

**Private by design.** No account, no server, no analytics. Photos, finds and your walking track are stored only in your browser (IndexedDB). You can export or erase everything from the Map tab.

## How it works
- **Identification:** CLIP (`Xenova/clip-vit-base-patch32`) running in the browser through Transformers.js. It matches the photo against a list of species. The model downloads once (about 90 MB) and is then cached, so identification works offline.
- **Map:** drawn on a canvas from your GPS points. No map tiles are downloaded, so nothing about where you walk leaves the phone.
- **Offline:** a service worker caches the app and the AI library.

## Run it
Camera and location need HTTPS (or localhost).

Quick test on a computer:

    python3 -m http.server 8000
    # open http://localhost:8000

On a phone: host the folder on GitHub Pages (free HTTPS):
1. Create a public GitHub repo, for example `wildtrail`, and upload these files.
2. Settings > Pages > Deploy from branch > `main` / root.
3. Open the Pages URL on your phone, allow camera and location, and use "Add to Home Screen".

Open the app once with internet so the model can download. After that it works offline.

## Known limits
- The species list is small and a general model will sometimes guess wrong, so every find needs your confirmation.
- Tracking only records while the app is open on screen.

## Licence
MIT
