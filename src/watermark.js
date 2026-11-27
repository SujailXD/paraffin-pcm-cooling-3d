// Faint "NebuCoders logo + SujailXD" mark painted flat on the scene floor.
import * as THREE from 'three';

export function addFloorWatermark(scene, { x, z, width, opacity = 0.32, rotation = 0 }) {
  const W = 2048, H = 640;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * H / W),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false }),
  );
  mesh.rotation.set(-Math.PI / 2, 0, rotation);
  mesh.position.set(x, 0.02, z);
  mesh.renderOrder = 1;
  scene.add(mesh);

  const img = new Image();
  img.onload = async () => {
    try { await document.fonts.load('500 150px "Host Grotesk"'); } catch { /* fall back to system font */ }
    const logoH = 300, logoW = logoH * img.naturalWidth / img.naturalHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, (W - logoW) / 2, 40, logoW, logoH);
    ctx.fillStyle = '#f2f4f7';
    ctx.font = '500 170px "Host Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('SujailXD', W / 2, H - 70);
    tex.needsUpdate = true;
  };
  img.src = 'assets/nebucoders-logo-dark.png';
  return mesh;
}
