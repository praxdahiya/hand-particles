// src/HandParticles.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import gsap from "gsap";

/**
 * Simple "open palm" heuristic:
 * measures average distance of fingertips from palm center.
 */
function isPalmOpen(landmarks) {
  const wrist = landmarks[0];
  const midMcp = landmarks[9];
  const cx = (wrist.x + midMcp.x) / 2;
  const cy = (wrist.y + midMcp.y) / 2;

  const tips = [4, 8, 12, 16, 20].map((i) => landmarks[i]);
  const dists = tips.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  });

  const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
  return avg > 0.18;
}

export default function HandParticles() {
  const mountRef = useRef(null);
  const videoRef = useRef(null);

  // keep refs for cleanup / access
  const currentModeRef = useRef("blob"); // "blob" | "text"
  const lastPalmRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;

    // ---------- THREE SETUP ----------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0b10");

    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // ---------- PARTICLES ----------
    const PARTICLE_COUNT = 6000;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const targets = new Float32Array(PARTICLE_COUNT * 3);

    // Initial blob (store for consistent return)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = 1.8 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      targets[i * 3 + 0] = x;
      targets[i * 3 + 1] = y;
      targets[i * 3 + 2] = z;
    }

    const basePositions = positions.slice(); // stable blob return
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.035,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // ---------- TEXT TARGETS VIA CANVAS (RELIABLE) ----------
    const makeTextTargetsFromCanvas = (text) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // Canvas resolution (higher = smoother text shape)
      canvas.width = 900;
      canvas.height = 260;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 150px serif";
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);

      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      const pts = [];
      const step = 2; // 1 = denser (heavier), 2 = good balance
      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          const i = (y * canvas.width + x) * 4;
          const a = img[i + 3]; // alpha
          if (a > 40) pts.push([x, y]);
        }
      }

      // If for some reason no points, fallback to center cloud
      if (pts.length < 10) {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          targets[i * 3 + 0] = (Math.random() - 0.5) * 2.0;
          targets[i * 3 + 1] = (Math.random() - 0.5) * 0.8;
          targets[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
        }
        return;
      }

      const scale = 0.01; // controls text size in 3D
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = pts[Math.floor(Math.random() * pts.length)];

        const x = (p[0] - cx) * scale;
        const y = -(p[1] - cy) * scale;
        const z = (Math.random() - 0.5) * 0.08; // depth jitter

        targets[i * 3 + 0] = x;
        targets[i * 3 + 1] = y;
        targets[i * 3 + 2] = z;
      }
    };

    const setTextTargets = () => {
      makeTextTargetsFromCanvas("I love you");
    };

    const setBlobTargets = () => {
      for (let i = 0; i < basePositions.length; i++) {
        targets[i] = basePositions[i];
      }
    };

    const morphTo = (mode) => {
      if (currentModeRef.current === mode) return;
      currentModeRef.current = mode;

      if (mode === "text") setTextTargets();
      else setBlobTargets();

      const posAttr = points.geometry.attributes.position;

      const proxy = { t: 0 };
      gsap.killTweensOf(proxy);

      const start = posAttr.array.slice();
      const end = targets;

      gsap.to(proxy, {
        t: 1,
        duration: 0.8,
        ease: "power2.out",
        onUpdate: () => {
          const t = proxy.t;
          const arr = posAttr.array;
          for (let i = 0; i < arr.length; i++) {
            arr[i] = start[i] + (end[i] - start[i]) * t;
          }
          posAttr.needsUpdate = true;
        },
      });
    };

    // ---------- ANIMATE ----------
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);

      // Rotate only in blob mode (looks cleaner)
      // smooth continuous rotation
points.rotation.y += 0.002;
points.rotation.x += 0.0006;


      renderer.render(scene, camera);
    };
    animate();

    // ---------- RESIZE ----------
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // ---------- MEDIAPIPE HANDS ----------
    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

    hands.onResults((results) => {
      const lm = results.multiHandLandmarks?.[0];
      const palmOpen = lm ? isPalmOpen(lm) : false;

      if (palmOpen !== lastPalmRef.current) {
        lastPalmRef.current = palmOpen;
        if (palmOpen) morphTo("text");
        else morphTo("blob");
      }
    });

    const startCamera = async () => {
      const videoEl = videoRef.current;
      const cam = new Camera(videoEl, {
        onFrame: async () => {
          await hands.send({ image: videoEl });
        },
        width: 640,
        height: 480,
      });
      cam.start();
    };

    startCamera().catch(console.error);

    // ---------- CLEANUP ----------
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);

      try {
        renderer.dispose();
      } catch {}

      if (renderer.domElement && mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <>
      {/* Full-screen Three.js mount */}
      <div
        ref={mountRef}
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
        }}
      />

      {/* Webcam preview (bottom-right) */}
      <video
        ref={videoRef}
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          width: 200,
          opacity: 0.2,
          transform: "scaleX(-1)",
          borderRadius: 12,
          zIndex: 10,
        }}
        autoPlay
        playsInline
        muted
      />
    </>
  );
}
