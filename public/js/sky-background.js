const canvas = document.getElementById("sky-canvas");

if (canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });

  if (!ctx) {
    throw new Error("Canvas 2D context not available");
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const colors = ["#f06f9d", "#ff9d3d", "#7a68ff", "#1f9d90", "#f3c846"];

  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let lastTime = 0;
  let animationsEnabled = false;
  let clouds = [];
  let skydivers = [];
  let skydiversLeftInBatch = 0;
  let nextSkydiverDropIn = 0;
  let nextSkydiverBatchAtAngle = 0;
  let swoopers = [];
  let plane = null;
  let nextSwooperIn = 0;

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const roundedRectPath = (x, y, widthValue, heightValue, radius) => {
    const r = Math.min(radius, widthValue * 0.5, heightValue * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + widthValue - r, y);
    ctx.quadraticCurveTo(x + widthValue, y, x + widthValue, y + r);
    ctx.lineTo(x + widthValue, y + heightValue - r);
    ctx.quadraticCurveTo(x + widthValue, y + heightValue, x + widthValue - r, y + heightValue);
    ctx.lineTo(x + r, y + heightValue);
    ctx.quadraticCurveTo(x, y + heightValue, x, y + heightValue - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  const createCloud = () => ({
    x: random(-120, width + 120),
    y: random(-20, height * 0.75),
    radius: random(32, 74),
    alpha: random(0.1, 0.28),
    speed: random(3, 11),
    wobbleOffset: random(0, Math.PI * 2),
    wobbleStrength: random(6, 18)
  });

  const createSkydiverFromPlane = (planeState) => {
    const headingCos = Math.cos(planeState.heading);
    const headingSin = Math.sin(planeState.heading);
    const localX = -planeState.size * random(0.45, 0.9);
    const localY = planeState.size * random(0.16, 0.55);
    const x = planeState.x + localX * headingCos - localY * headingSin;
    const y = planeState.y + localX * headingSin + localY * headingCos;

    return {
      x,
      y,
      vx: planeState.vx * 0.32 + random(-14, 14),
      vy: planeState.vy * 0.2 + random(42, 70),
      gravity: random(22, 40),
      drift: random(8, 22),
      driftOffset: random(0, Math.PI * 2),
      size: random(14, 22),
      color: colors[Math.floor(Math.random() * colors.length)]
    };
  };

  const createSwooper = () => {
    const fromLeft = Math.random() > 0.5;
    const direction = fromLeft ? 1 : -1;
    const size = random(16, 24);
    const startY = random(height * 0.64, height * 0.86);

    return {
      x: fromLeft ? -90 : width + 90,
      y: startY,
      direction,
      speed: random(290, 430),
      sink: random(8, 24),
      sway: random(8, 22),
      swayOffset: random(0, Math.PI * 2),
      size,
      color: colors[Math.floor(Math.random() * colors.length)],
      age: 0,
      trail: []
    };
  };

  const createPlane = () => {
    const angle = random(0, Math.PI * 2);
    const radiusX = Math.max(150, width * 0.34);
    const radiusY = Math.max(44, height * 0.1);
    const centerX = width * 0.5;
    const centerY = Math.max(72, height * 0.2);
    const size = clamp(width * 0.015, 10, 18);
    const x = centerX + Math.cos(angle) * radiusX;
    const y = centerY + Math.sin(angle) * radiusY;

    return {
      x,
      y,
      vx: 0,
      vy: 0,
      angle,
      orbitSpeed: random(0.17, 0.24),
      radiusX,
      radiusY,
      centerX,
      centerY,
      size,
      heading: 0,
      tangentSpeed: 0
    };
  };

  const scheduleNextSkydiverBatch = () => {
    if (!plane) {
      nextSkydiverBatchAtAngle = Math.PI * 2;
      return;
    }

    // Keep at least one full lap, then add a random offset so batch locations vary.
    const extraTravel = Math.PI * 2 + random(0, Math.PI * 1.4);
    nextSkydiverBatchAtAngle = plane.angle + extraTravel;
  };

  const buildScene = () => {
    const cloudCount = width < 700 ? 8 : 14;

    clouds = Array.from({ length: cloudCount }, () => createCloud());
    skydivers = [];
    skydiversLeftInBatch = 4;
    nextSkydiverDropIn = random(0.35, 0.8);
    swoopers = [];
    plane = createPlane();
    scheduleNextSkydiverBatch();
    nextSwooperIn = random(1.8, 5.5);
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScene();

    if (!animationsEnabled) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    if (prefersReducedMotion.matches) {
      ctx.clearRect(0, 0, width, height);
      clouds.forEach((cloud) => drawCloud(cloud, 0));
    }
  };

  const drawCloud = (cloud, elapsed) => {
    const y = cloud.y + Math.sin(elapsed * 0.00025 + cloud.wobbleOffset) * cloud.wobbleStrength;
    const x = cloud.x;

    ctx.save();
    ctx.globalAlpha = cloud.alpha;
    ctx.fillStyle = "#ffffff";

    ctx.beginPath();
    ctx.arc(x - cloud.radius * 0.42, y, cloud.radius * 0.62, 0, Math.PI * 2);
    ctx.arc(x + cloud.radius * 0.06, y - cloud.radius * 0.16, cloud.radius * 0.7, 0, Math.PI * 2);
    ctx.arc(x + cloud.radius * 0.58, y, cloud.radius * 0.56, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const updatePlane = (deltaSeconds) => {
    if (!plane) {
      return;
    }

    const nextAngle = plane.angle + plane.orbitSpeed * deltaSeconds;
    const nextX = plane.centerX + Math.cos(nextAngle) * plane.radiusX;
    const nextY = plane.centerY + Math.sin(nextAngle) * plane.radiusY;

    if (deltaSeconds > 0) {
      plane.vx = (nextX - plane.x) / deltaSeconds;
      plane.vy = (nextY - plane.y) / deltaSeconds;
    }

    plane.angle = nextAngle;
    plane.x = nextX;
    plane.y = nextY;
    plane.tangentSpeed = Math.hypot(plane.vx, plane.vy);

    if (plane.tangentSpeed > 1) {
      plane.heading = Math.atan2(plane.vy, plane.vx);
    }
  };

  const drawPlane = (elapsed) => {
    if (!plane) {
      return;
    }

    const s = plane.size;
    const propPulse = 0.65 + Math.sin(elapsed * 0.03) * 0.35;
    const bank = Math.sin(plane.angle) * 0.18;

    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.rotate(plane.heading + bank);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.1, s * 0.32, s * 2.1, s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c11423";
    roundedRectPath(-s * 2.2, -s * 0.26, s * 3.95, s * 0.52, s * 0.22);
    ctx.fill();

    ctx.fillStyle = "#f4c319";
    roundedRectPath(-s * 0.7, -s * 1.03, s * 1.25, s * 2.06, s * 0.22);
    ctx.fill();

    roundedRectPath(-s * 2.2, -s * 0.88, s * 0.68, s * 0.52, s * 0.14);
    ctx.fill();

    roundedRectPath(-s * 2.22, -s * 0.38, s * 0.95, s * 0.18, s * 0.09);
    ctx.fill();

    ctx.fillStyle = "#f4c319";
    roundedRectPath(-s * 1.95, -s * 0.06, s * 2.45, s * 0.12, s * 0.06);
    ctx.fill();

    ctx.fillStyle = "rgba(11, 17, 22, 0.55)";
    roundedRectPath(-s * 0.42, -s * 0.2, s * 1.02, s * 0.4, s * 0.12);
    ctx.fill();

    ctx.strokeStyle = "rgba(22, 25, 29, 0.72)";
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, s * 0.27);
    ctx.lineTo(-s * 0.06, s * 0.56);
    ctx.moveTo(s * 0.46, s * 0.27);
    ctx.lineTo(s * 0.58, s * 0.56);
    ctx.moveTo(-s * 0.18, s * 0.56);
    ctx.lineTo(s * 0.64, s * 0.56);
    ctx.stroke();

    const propX = s * 1.74;
    ctx.strokeStyle = `rgba(224, 231, 240, ${0.28 + propPulse * 0.28})`;
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.moveTo(propX, -s * 0.46);
    ctx.lineTo(propX, s * 0.46);
    ctx.stroke();

    ctx.strokeStyle = `rgba(224, 231, 240, ${0.14 + propPulse * 0.22})`;
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(propX + s * 0.1, -s * 0.52);
    ctx.lineTo(propX + s * 0.1, s * 0.52);
    ctx.stroke();

    ctx.restore();
  };

  const drawSkydiver = (skydiver, elapsed) => {
    const sway = Math.sin(elapsed * 0.0012 + skydiver.driftOffset) * skydiver.drift;
    const x = skydiver.x + sway;
    const y = skydiver.y;
    const size = skydiver.size;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(16, 35, 27, 0.62)";
    ctx.lineWidth = Math.max(1.1, size * 0.09);

    ctx.fillStyle = skydiver.color;
    ctx.beginPath();
    ctx.ellipse(x, y - size * 0.95, size * 1.3, size * 0.58, 0, Math.PI, 0, true);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x - size * 0.82, y - size * 0.95);
    ctx.lineTo(x - size * 0.18, y - size * 0.28);
    ctx.moveTo(x + size * 0.82, y - size * 0.95);
    ctx.lineTo(x + size * 0.18, y - size * 0.28);
    ctx.stroke();

    ctx.fillStyle = "rgba(16, 35, 27, 0.84)";
    ctx.beginPath();
    ctx.arc(x, y - size * 0.08, size * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.06);
    ctx.lineTo(x, y + size * 0.56);
    ctx.moveTo(x, y + size * 0.26);
    ctx.lineTo(x - size * 0.34, y + size * 0.44);
    ctx.moveTo(x, y + size * 0.26);
    ctx.lineTo(x + size * 0.34, y + size * 0.44);
    ctx.moveTo(x, y + size * 0.56);
    ctx.lineTo(x - size * 0.3, y + size * 0.95);
    ctx.moveTo(x, y + size * 0.56);
    ctx.lineTo(x + size * 0.3, y + size * 0.95);
    ctx.stroke();
    ctx.restore();
  };

  const drawSwooper = (swooper, elapsed) => {
    const size = swooper.size;
    const direction = swooper.direction;
    const x = swooper.x;
    const y = swooper.y + Math.sin(elapsed * 0.003 + swooper.swayOffset) * swooper.sway;
    const speedFactor = Math.min(1.45, swooper.speed / 300);

    swooper.trail.push({ x, y });
    if (swooper.trail.length > 24) {
      swooper.trail.shift();
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < swooper.trail.length; i += 1) {
      const prev = swooper.trail[i - 1];
      const next = swooper.trail[i];
      const progress = i / (swooper.trail.length - 1);
      ctx.strokeStyle = `rgba(190, 231, 255, ${0.08 + progress * 0.24})`;
      ctx.lineWidth = Math.max(0.9, size * (0.04 + progress * 0.12) * speedFactor);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }

    for (let i = 1; i < swooper.trail.length; i += 1) {
      const prev = swooper.trail[i - 1];
      const next = swooper.trail[i];
      const progress = i / (swooper.trail.length - 1);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 + progress * 0.14})`;
      ctx.lineWidth = Math.max(0.55, size * (0.018 + progress * 0.04));
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }

    ctx.translate(x, y);
    ctx.scale(direction, 1);

    const pulse = 0.8 + Math.sin(elapsed * 0.012 + swooper.age * 5) * 0.2;
    const wakeLength = size * (4.8 + speedFactor * 3.6);
    const wakeHalfWidth = size * (0.32 + speedFactor * 0.2);

    const wakeGradient = ctx.createLinearGradient(-wakeLength, 0, 0, 0);
    wakeGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    wakeGradient.addColorStop(0.55, `rgba(194, 234, 255, ${0.12 * pulse})`);
    wakeGradient.addColorStop(1, `rgba(255, 255, 255, ${0.42 * pulse})`);
    ctx.fillStyle = wakeGradient;
    ctx.beginPath();
    ctx.moveTo(-wakeLength, -wakeHalfWidth);
    ctx.lineTo(0, -size * 0.16);
    ctx.lineTo(0, size * 0.16);
    ctx.lineTo(-wakeLength, wakeHalfWidth);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * pulse})`;
    ctx.lineWidth = Math.max(0.9, size * 0.06);
    for (let i = 0; i < 4; i += 1) {
      const laneY = (-0.27 + i * 0.18) * size;
      const laneDrift = Math.sin(elapsed * 0.015 + swooper.age * 9 + i * 1.6) * size * 0.03;
      const laneLength = wakeLength * (0.5 + i * 0.11);

      ctx.beginPath();
      ctx.moveTo(-size * 0.05, laneY + laneDrift);
      ctx.lineTo(-laneLength, laneY + laneDrift + (i - 1.5) * size * 0.03);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(16, 35, 27, 0.72)";
    ctx.lineWidth = Math.max(1.2, size * 0.1);

    ctx.fillStyle = swooper.color;
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.92, size * 1.8, size * 0.46, 0, Math.PI, 0, true);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-size * 0.98, -size * 0.9);
    ctx.lineTo(-size * 0.35, -size * 0.16);
    ctx.moveTo(size * 0.98, -size * 0.9);
    ctx.lineTo(size * 0.35, -size * 0.16);
    ctx.stroke();

    ctx.fillStyle = "rgba(16, 35, 27, 0.88)";
    ctx.beginPath();
    ctx.arc(size * 0.14, -size * 0.06, size * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(size * 0.02, size * 0.05);
    ctx.lineTo(size * 0.82, size * 0.18);
    ctx.moveTo(size * 0.34, size * 0.12);
    ctx.lineTo(size * 0.58, size * 0.54);
    ctx.stroke();
    ctx.restore();
  };

  const tick = (timestamp) => {
    if (!lastTime) {
      lastTime = timestamp;
    }

    const deltaSeconds = Math.min(0.05, (timestamp - lastTime) / 1000);
    lastTime = timestamp;

    ctx.clearRect(0, 0, width, height);

    for (const cloud of clouds) {
      cloud.x += cloud.speed * deltaSeconds;
      if (cloud.x - cloud.radius * 1.4 > width) {
        cloud.x = -cloud.radius * 1.6;
        cloud.y = random(-20, height * 0.75);
        cloud.alpha = random(0.1, 0.28);
        cloud.speed = random(3, 11);
      }

      drawCloud(cloud, timestamp);
    }

    updatePlane(deltaSeconds);
    drawPlane(timestamp);

    if (plane && skydiversLeftInBatch <= 0 && plane.angle >= nextSkydiverBatchAtAngle) {
      skydiversLeftInBatch = 4;
      nextSkydiverDropIn = random(0.16, 0.7);
    }

    if (skydiversLeftInBatch > 0) {
      nextSkydiverDropIn -= deltaSeconds;
      if (nextSkydiverDropIn <= 0) {
        if (plane && skydivers.length < 24) {
          skydivers.push(createSkydiverFromPlane(plane));
          skydiversLeftInBatch -= 1;
          nextSkydiverDropIn = random(0.18, 0.65);

          if (skydiversLeftInBatch <= 0) {
            scheduleNextSkydiverBatch();
          }
        } else {
          nextSkydiverDropIn = 0.35;
        }
      }
    }

    for (let i = skydivers.length - 1; i >= 0; i -= 1) {
      const skydiver = skydivers[i];
      skydiver.vy += skydiver.gravity * deltaSeconds;
      skydiver.vx *= 0.998;
      skydiver.x += skydiver.vx * deltaSeconds;
      skydiver.y += skydiver.vy * deltaSeconds;

      drawSkydiver(skydiver, timestamp);

      const outBottom = skydiver.y - skydiver.size > height + 22;
      const outLeft = skydiver.x + skydiver.size < -30;
      const outRight = skydiver.x - skydiver.size > width + 30;
      if (outBottom || outLeft || outRight) {
        skydivers.splice(i, 1);
      }
    }

    nextSwooperIn -= deltaSeconds;
    if (nextSwooperIn <= 0 && swoopers.length < 3) {
      swoopers.push(createSwooper());
      nextSwooperIn = random(4.5, 10.5);
    }

    for (let i = swoopers.length - 1; i >= 0; i -= 1) {
      const swooper = swoopers[i];
      swooper.age += deltaSeconds;
      swooper.x += swooper.speed * swooper.direction * deltaSeconds;
      swooper.y += swooper.sink * deltaSeconds;

      drawSwooper(swooper, timestamp);

      const outsideRight = swooper.direction === 1 && swooper.x - swooper.size > width + 120;
      const outsideLeft = swooper.direction === -1 && swooper.x + swooper.size < -120;
      const outsideBottom = swooper.y - swooper.size > height + 70;
      if (outsideRight || outsideLeft || outsideBottom) {
        swoopers.splice(i, 1);
      }
    }

    animationFrame = window.requestAnimationFrame(tick);
  };

  const stop = () => {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };

  const start = () => {
    if (prefersReducedMotion.matches || animationFrame || !animationsEnabled) {
      return;
    }

    lastTime = 0;
    animationFrame = window.requestAnimationFrame(tick);
  };

  const setAnimationsEnabled = (enabled) => {
    animationsEnabled = Boolean(enabled);

    if (!animationsEnabled) {
      stop();
      ctx.clearRect(0, 0, width, height);
      return;
    }

    if (prefersReducedMotion.matches) {
      stop();
      ctx.clearRect(0, 0, width, height);
      clouds.forEach((cloud) => drawCloud(cloud, 0));
      return;
    }

    start();
  };

  resize();
  setAnimationsEnabled(false);

  window.addEventListener("manifest:loads-state", (event) => {
    const hasLoads = Boolean(event?.detail?.hasLoads);
    setAnimationsEnabled(hasLoads);
  });

  window.addEventListener("resize", resize, { passive: true });
  prefersReducedMotion.addEventListener("change", (event) => {
    if (!animationsEnabled) {
      stop();
      ctx.clearRect(0, 0, width, height);
      return;
    }

    if (event.matches) {
      stop();
      ctx.clearRect(0, 0, width, height);
      clouds.forEach((cloud) => drawCloud(cloud, 0));
      return;
    }

    start();
  });
}
