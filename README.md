# Paraffin wax cooling for AI chips, in 3D

Interactive 3D models of a hybrid phase change material (PCM) cooling system that cools AI GPUs with microencapsulated paraffin wax and uses no water.

**Live:** https://sujailxd.github.io/paraffin-pcm-cooling-3d/

- [Data centre loop](https://sujailxd.github.io/paraffin-pcm-cooling-3d/index.html): a rack of 72 GPUs, a slurry tank, a dry cooler outside the building and a pump.
- [One GPU up close](https://sujailxd.github.io/paraffin-pcm-cooling-3d/gpu.html): GPU and cold plate, a sealed paraffin container with a chimney, an external dry cooler and a circulation pump. Try the AI burst and broken-fan scenarios.

Every wax bead is a parcel of slurry carrying its own heat, so what you see is the simulation itself. Change the GPU power, outside air temperature and wax type (C22, C24, C28) and watch the readings. The assumptions are listed on each page under "How the model works".

Demo video: [video/PCM Cooling Model - SujailXD NebuCoders.mp4](video/)

## Run it locally

Open `index.html` or `gpu.html` in a browser. No install needed.

To rebuild after editing `src/`: `npm install`, then
`npx esbuild src/main.js --bundle --format=iife --minify --outfile=app.js` and
`npx esbuild src/gpu.js --bundle --format=iife --minify --outfile=gpu.js`.

Built by SujailXD, NebuCoders. Made with Three.js.
