# Photo Layout

A website that lays out 2–12 photos on a single sheet of paper (A4 by default).
Photos of any size are arranged, scaled and rotated automatically to fill the page.
It is built for iPhone and iPad (Safari) and also works on a computer.

Everything runs in the visitor's browser. Photos are never uploaded, and the site
is just static files (no backend or database).

## Features

- Add 2–12 photos from the Photos library (HEIC is converted automatically by iOS).
- Automatic layout that fills the paper. A photo is only lightly cropped when its
  shape doesn't match its space. **Layout** cycles through alternative arrangements.
- Paper: A3, A4, A5, Letter, Legal, 4×6 in, 5×7 in, or a custom size in mm.
  Portrait, landscape, or **Best fit** (picks whichever fits the photos better).
- Margin, spacing between photos, background colour, and an option to allow
  rotating photos 90° for a better fit.
- Tap a photo to adjust it: drag to choose which part shows, pinch or use
  Smaller/Larger to zoom, Rotate, Reset, Swap with another photo, Replace it
  with a different photo (the frames stay as they are), or Remove.
- **Adjust (調色)**: change a photo's brightness, contrast, saturation and
  warmth, or tap a preset (Original, B&W, Vivid, Warm, Cool). Edits show live,
  stay with the photo when it's swapped, and are included in exports. The
  original is kept, so Reset always gets it back unchanged.
- Double-tap a photo to show the whole photo inside its frame (no cropping,
  with empty space on two sides). Double-tap again, or Reset, to fill the frame.
- Resize frames by dragging the lines between photos (each line has a small
  handle). The frames on both sides grow or shrink and the page stays filled.
  Frames can't be made smaller than 8 mm.
- English and Traditional Chinese (繁體中文). Uses the device language on the
  first visit; the **中文 / EN** button in the top bar switches and is remembered.
  Text lives in [js/i18n.js](js/i18n.js).
- Export a **PDF** at the exact paper size, or a **JPG**, at 150 or 300 dpi.
  Share/Save sends it to Photos, Files, AirDrop, Print and so on.
- Can be added to the Home Screen and used offline (needs HTTPS, see below).

## Run it on your computer

Requires [Node.js](https://nodejs.org/) 18 or newer. There are no packages to install.

```sh
npm start
```

The terminal prints two addresses:

- `http://localhost:5173/` opens the site on this computer.
- `http://192.168.x.x:5173/` opens it from an iPhone or iPad **on the same Wi-Fi**.

Your computer is the server here, so the site only works while `npm start` is
running and only inside your home network. Offline use and "Add to Home Screen"
as an app need HTTPS, which the public hosting below provides.

## Publish it so anyone can use it (GitHub Pages, free)

1. Create a new repository on GitHub, for example `photo-layout`.
2. Push this folder to it:
   ```sh
   git add .
   git commit -m "Photo Layout website"
   git branch -M main
   git remote add origin https://github.com/<your-name>/photo-layout.git
   git push -u origin main
   ```
3. On GitHub open **Settings → Pages**. Under *Build and deployment*, choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After about a minute the site is live at
   `https://<your-name>.github.io/photo-layout/`. Share that link.

Your computer does not need to be on. To update the site, commit and push again.
Netlify and Cloudflare Pages work the same way (drag-and-drop the folder).

On iPhone/iPad: open the link in Safari, tap **Share → Add to Home Screen**, and
it opens full-screen like an app.

## Tests

```sh
npm test
```

The tests cover the layout engine (every photo placed once, inside the margins,
no overlaps, little cropping for 2–12 photos) and the PDF writer.

## How the automatic layout works

A layout is a tree of straight cuts: each cut splits a rectangle into two parts
side by side or stacked, down to one photo per part. Since each photo's aspect
ratio is known, the tree has an exact natural shape:

- side by side: `a = a1 + a2`
- stacked: `1/a = 1/a1 + 1/a2`

The engine ([js/layout.js](js/layout.js)) searches many random trees, improving
each by flipping cuts, swapping photos, rotating photos and reshaping the tree. It
scores each candidate by how much cropping it needs, how unequal the photo sizes
are, and how many photos are rotated. The best distinct results become the
alternatives behind the **Layout** button. A search takes about 10 ms.

For 3 or more photos the best layout typically crops under 3% of any photo. With
only 2 photos some shape combinations can't fill the page closely (for example a
4:3 and a square photo on portrait A4), and **Best fit** orientation helps there.

## Project structure

```
index.html            page structure, toolbars and dialogs
css/app.css           styles (light and dark mode, iPhone safe areas)
js/app.js             UI: loading photos, gestures, settings, export
js/layout.js          layout engine (no DOM, unit-tested)
js/render.js          draws a layout onto a canvas (preview and export)
js/pdf.js             minimal PDF writer (one page, one JPEG)
sw.js                 service worker for offline use
manifest.webmanifest  Home Screen app metadata
icons/                app icons (regenerate with `npm run icons`)
scripts/serve.mjs     local development server
tests/                Node tests
```

## Limits

- Photos are downscaled to about 3.5 megapixels on load, so 12 photos stay within
  iPhone memory limits. That is enough for 300 dpi prints on A4.
- Exports are capped at 16 megapixels (an iOS Safari canvas limit), so A3 at
  "300 dpi" comes out at about 230 dpi.
- Adjusting a photo (pan, zoom, rotate) or resizing frames is kept until the
  photos or paper settings change, or you switch to another layout. Those create
  a fresh layout. Switching layouts and coming back undoes frame resizing.
