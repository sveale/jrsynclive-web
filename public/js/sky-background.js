const canvas = document.getElementById("sky-canvas");

if (canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });

  if (!ctx) {
    throw new Error("Canvas 2D context not available");
  }

  const animationsToggleEl = document.getElementById("animations-toggle");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const viewerConfigStorageKey = "bfsk:viewer-config";
  const defaultViewerConfig = Object.freeze({
    animationsEnabled: true
  });
  const colors = ["#f06f9d", "#ff9d3d", "#7a68ff", "#1f9d90", "#f3c846"];
  const jumpTypes = ["freefall", "tracking", "formation", "wingsuit"];
  const freefallPoses = ["headup", "headdown", "sit"];
  const freefallVerticalSpeedMultiplier = 3;
  const canopyVerticalSpeedMultiplier = 4.5;

  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let lastTime = 0;
  let animationsEnabled = false;
  let clouds = [];
  let skydivers = [];
  let pendingSkydiverRun = null;
  let nextSkydiverDropIn = 0;
  let nextSkydiverBatchAtAngle = 0;
  let skydiverGroupId = 0;
  let swoopers = [];
  let plane = null;
  let nextSwooperIn = 0;
  let viewerConfig = { ...defaultViewerConfig };

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const randomInt = (min, max) => Math.floor(random(min, max + 1));
  const pickRandom = (items) => items[Math.floor(Math.random() * items.length)];
  const syncAnimationsToggle = (enabled) => {
    if (!animationsToggleEl) {
      return;
    }

    animationsToggleEl.checked = Boolean(enabled);
  };

  const readViewerConfig = () => {
    try {
      const raw = window.localStorage.getItem(viewerConfigStorageKey);
      if (!raw) {
        return { ...defaultViewerConfig };
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { ...defaultViewerConfig };
      }

      return {
        ...defaultViewerConfig,
        animationsEnabled:
          typeof parsed.animationsEnabled === "boolean"
            ? parsed.animationsEnabled
            : defaultViewerConfig.animationsEnabled
      };
    } catch {
      return { ...defaultViewerConfig };
    }
  };

  const writeViewerConfig = (nextConfig) => {
    try {
      window.localStorage.setItem(viewerConfigStorageKey, JSON.stringify(nextConfig));
    } catch {
      // Ignore storage failures (private mode, full quota, denied storage).
    }
  };

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

  const skydiverProfileForJump = (jumpType) => {
    switch (jumpType) {
      case "tracking":
        return {
          gravity: [18, 29],
          airDrag: [0.9952, 0.9974],
          initialFall: [34, 54],
          glide: [26, 46],
          drift: [10, 21],
          canopySink: [19, 30],
          canopySteer: [30, 49]
        };
      case "formation":
        return {
          gravity: [21, 34],
          airDrag: [0.997, 0.999],
          initialFall: [38, 58],
          glide: [5, 16],
          drift: [8, 17],
          canopySink: [18, 29],
          canopySteer: [22, 40]
        };
      case "wingsuit":
        return {
          gravity: [12, 22],
          airDrag: [0.9934, 0.9962],
          initialFall: [26, 42],
          glide: [44, 72],
          drift: [14, 26],
          canopySink: [16, 27],
          canopySteer: [34, 56]
        };
      case "freefall":
      default:
        return {
          gravity: [22, 36],
          airDrag: [0.9964, 0.9988],
          initialFall: [42, 68],
          glide: [8, 22],
          drift: [8, 18],
          canopySink: [19, 31],
          canopySteer: [24, 43]
        };
    }
  };

  const createSkydiverGroup = (size) => {
    return {
      id: (skydiverGroupId += 1),
      size,
      jumpType: pickRandom(jumpTypes),
      horizontalDirection: Math.random() > 0.5 ? 1 : -1,
      membersLeft: size,
      anchorX: null
    };
  };

  const createSkydiverRun = () => {
    let remaining = 4;
    const groupSizes = [];

    while (remaining > 0) {
      const nextSize = randomInt(1, remaining);
      groupSizes.push(nextSize);
      remaining -= nextSize;
    }

    // Shuffle so we get more varied run compositions and orderings.
    for (let i = groupSizes.length - 1; i > 0; i -= 1) {
      const swapIndex = randomInt(0, i);
      [groupSizes[i], groupSizes[swapIndex]] = [groupSizes[swapIndex], groupSizes[i]];
    }

    return {
      groups: groupSizes.map((size) => createSkydiverGroup(size)),
      groupIndex: 0
    };
  };

  const createSkydiverFromPlane = (planeState, group, memberIndex) => {
    const profile = skydiverProfileForJump(group.jumpType);
    const headingCos = Math.cos(planeState.heading);
    const headingSin = Math.sin(planeState.heading);
    const slot = group.size > 1 ? memberIndex - (group.size - 1) * 0.5 : 0;
    const slotBase = Math.max((group.size - 1) * 0.5, 0.5);
    const slotNormalized = group.size > 1 ? slot / slotBase : 0;
    const localX = -planeState.size * random(0.45, 0.9);
    const localY = planeState.size * random(0.16, 0.55) + slot * planeState.size * 0.1;
    const spawnJitter = random(-planeState.size * 0.07, planeState.size * 0.07);
    const x =
      planeState.x + localX * headingCos - localY * headingSin + spawnJitter * headingCos;
    const y =
      planeState.y + localX * headingSin + localY * headingCos + spawnJitter * headingSin;

    if (typeof group.anchorX !== "number") {
      group.anchorX = x;
    }

    return {
      x,
      y,
      vx:
        planeState.vx * 0.28 +
        random(-8, 8) +
        group.horizontalDirection * random(profile.glide[0], profile.glide[1]) * 0.12,
      vy: planeState.vy * 0.2 + random(profile.initialFall[0], profile.initialFall[1]),
      gravity: random(profile.gravity[0], profile.gravity[1]),
      airDrag: random(profile.airDrag[0], profile.airDrag[1]),
      glideStrength: random(profile.glide[0], profile.glide[1]),
      glideDirection: group.horizontalDirection,
      glideOffset: random(0, Math.PI * 2),
      drift: random(profile.drift[0], profile.drift[1]),
      driftOffset: random(0, Math.PI * 2),
      size: random(13, 20),
      color: pickRandom(colors),
      canopyColor: pickRandom(colors),
      jumpType: group.jumpType,
      freefallPose: group.jumpType === "freefall" ? pickRandom(freefallPoses) : null,
      groupId: group.id,
      groupSize: group.size,
      groupAnchorX: group.anchorX,
      separationOffsetX: slotNormalized * random(62, 112),
      separationOffsetY: random(-18, 22),
      separationBurstX:
        slotNormalized === 0
          ? random(-12, 12)
          : Math.sign(slotNormalized) * random(20, 46),
      hasSeparated: false,
      deployAtY: height * (2 / 3),
      canopyDeployed: false,
      canopyInflation: 0,
      canopySink: random(profile.canopySink[0], profile.canopySink[1]),
      canopySteer: random(profile.canopySteer[0], profile.canopySteer[1]),
      canopyDrag: random(0.88, 0.93),
      canopyTurnOffset: random(0, Math.PI * 2),
      age: 0
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
      speed: random(290, 430) * 1.5,
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
    const radiusX = Math.max(180, width * 0.4);
    const radiusY = Math.max(22, height * 0.07);
    const centerX = width * 0.5;
    const centerY = Math.max(72, height * 0.2);
    const size = clamp(width * 0.015, 10, 18);
    const x = centerX + Math.sin(angle) * radiusX;
    const y = centerY + Math.sin(angle * 2) * radiusY * 0.42;

    return {
      x,
      y,
      vx: 0,
      vy: 0,
      angle,
      orbitSpeed: random(0.2, 0.28),
      radiusX,
      radiusY,
      centerX,
      centerY,
      size,
      direction: Math.cos(angle) >= 0 ? 1 : -1,
      pitch: 0,
      bank: 0,
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
    skydiverGroupId = 0;
    pendingSkydiverRun = createSkydiverRun();
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
    const nextX = plane.centerX + Math.sin(nextAngle) * plane.radiusX;
    const nextY = plane.centerY + Math.sin(nextAngle * 2) * plane.radiusY * 0.42;

    if (deltaSeconds > 0) {
      plane.vx = (nextX - plane.x) / deltaSeconds;
      plane.vy = (nextY - plane.y) / deltaSeconds;
    }

    plane.angle = nextAngle;
    plane.x = nextX;
    plane.y = nextY;
    plane.tangentSpeed = Math.hypot(plane.vx, plane.vy);

    if (plane.tangentSpeed > 1) {
      if (Math.abs(plane.vx) > 6) {
        plane.direction = plane.vx >= 0 ? 1 : -1;
      }

      const pitchTarget = clamp(Math.atan2(plane.vy, Math.abs(plane.vx) + 0.001), -0.34, 0.34);
      const pitchLerp = Math.min(1, deltaSeconds * 5.8);
      plane.pitch += (pitchTarget - plane.pitch) * pitchLerp;
      plane.heading = plane.direction === 1 ? plane.pitch : Math.PI - plane.pitch;

      const bankTarget = clamp(-Math.sin(nextAngle) * 0.34, -0.34, 0.34);
      const bankLerp = Math.min(1, deltaSeconds * 3.4);
      plane.bank += (bankTarget - plane.bank) * bankLerp;
    }
  };

  const drawPlane = (elapsed) => {
    if (!plane) {
      return;
    }

    const s = plane.size;
    const propPulse = 0.65 + Math.sin(elapsed * 0.03) * 0.35;
    const bank = plane.bank || 0;
    const fuselageX = -s * 2.35;
    const fuselageY = -s * 0.34;
    const fuselageW = s * 4.7;
    const fuselageH = s * 0.68;
    const propHubX = fuselageX + fuselageW + s * 0.02;

    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.rotate((plane.pitch || 0) + bank);
    ctx.scale(plane.direction || 1, 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.1, s * 0.56, s * 2.55, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cessna-182-like profile with high wing and fixed tricycle gear.
    ctx.fillStyle = "#c7212f";
    roundedRectPath(fuselageX, fuselageY, fuselageW, fuselageH, s * 0.28);
    ctx.fill();

    ctx.fillStyle = "#f6ca3b";
    roundedRectPath(-s * 2.04, -s * 0.04, s * 3.96, s * 0.18, s * 0.08);
    ctx.fill();

    ctx.fillStyle = "#f4b426";
    roundedRectPath(-s * 0.7, -s * 0.84, s * 1.62, s * 0.54, s * 0.14);
    ctx.fill();

    ctx.fillStyle = "#f6ca3b";
    roundedRectPath(-s * 1.26, -s * 1.08, s * 2.65, s * 0.25, s * 0.1);
    ctx.fill();

    ctx.fillStyle = "#c7212f";
    roundedRectPath(-s * 1.0, -s * 0.99, s * 2.08, s * 0.08, s * 0.03);
    ctx.fill();

    ctx.fillStyle = "#f6ca3b";
    roundedRectPath(-s * 2.16, -s * 0.56, s * 0.53, s * 0.22, s * 0.08);
    ctx.fill();
    roundedRectPath(-s * 2.08, -s * 0.44, s * 0.92, s * 0.12, s * 0.06);
    ctx.fill();

    ctx.fillStyle = "rgba(17, 26, 38, 0.62)";
    roundedRectPath(-s * 0.52, -s * 0.76, s * 1.44, s * 0.34, s * 0.1);
    ctx.fill();

    ctx.fillStyle = "#f3f6fa";
    ctx.beginPath();
    ctx.moveTo(fuselageX + fuselageW - s * 0.03, fuselageY + s * 0.12);
    ctx.lineTo(fuselageX + fuselageW + s * 0.17, fuselageY + s * 0.2);
    ctx.lineTo(fuselageX + fuselageW + s * 0.17, fuselageY + fuselageH - s * 0.2);
    ctx.lineTo(fuselageX + fuselageW - s * 0.03, fuselageY + fuselageH - s * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(26, 38, 53, 0.68)";
    ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.beginPath();
    ctx.moveTo(-s * 0.64, -s * 0.84);
    ctx.lineTo(-s * 0.34, s * 0.16);
    ctx.moveTo(s * 0.76, -s * 0.84);
    ctx.lineTo(s * 0.58, s * 0.19);
    ctx.moveTo(-s * 0.22, s * 0.22);
    ctx.lineTo(-s * 0.4, s * 0.66);
    ctx.moveTo(s * 0.52, s * 0.2);
    ctx.lineTo(s * 0.68, s * 0.66);
    ctx.moveTo(s * 1.56, s * 0.12);
    ctx.lineTo(s * 1.7, s * 0.62);
    ctx.stroke();

    ctx.fillStyle = "rgba(24, 31, 40, 0.92)";
    ctx.beginPath();
    ctx.arc(-s * 0.42, s * 0.67, s * 0.13, 0, Math.PI * 2);
    ctx.arc(s * 0.7, s * 0.67, s * 0.13, 0, Math.PI * 2);
    ctx.arc(s * 1.72, s * 0.64, s * 0.11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#d8dde6";
    ctx.beginPath();
    ctx.arc(propHubX, 0, s * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(224, 231, 240, ${0.28 + propPulse * 0.28})`;
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(propHubX, -s * 0.64);
    ctx.lineTo(propHubX, s * 0.64);
    ctx.stroke();

    ctx.strokeStyle = `rgba(224, 231, 240, ${0.14 + propPulse * 0.22})`;
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(propHubX + s * 0.1, -s * 0.58);
    ctx.lineTo(propHubX + s * 0.1, s * 0.58);
    ctx.stroke();

    ctx.restore();
  };

  const drawBodyPose = (x, y, size, color, pose) => {
    const rotation = pose.rotation || 0;
    const armSpan = pose.armSpan ?? 0.72;
    const armDrop = pose.armDrop ?? 0.26;
    const legSpan = pose.legSpan ?? 0.34;
    const legDrop = pose.legDrop ?? 0.52;
    const torsoLength = pose.torsoLength ?? 1;
    const bentLegs = pose.bentLegs ?? 0;
    const wingSpan = pose.wingSpan ?? 0;

    const torsoTop = -size * 0.56;
    const torsoHeight = size * torsoLength;
    const torsoBottom = torsoTop + torsoHeight;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.fillStyle = color;
    roundedRectPath(-size * 0.18, torsoTop, size * 0.36, torsoHeight, size * 0.11);
    ctx.fill();

    if (wingSpan > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.24)";
      ctx.beginPath();
      ctx.moveTo(-size * 0.17, torsoTop + size * 0.18);
      ctx.lineTo(-size * wingSpan, torsoTop + size * 0.52);
      ctx.lineTo(-size * 0.13, torsoBottom - size * 0.08);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(size * 0.17, torsoTop + size * 0.18);
      ctx.lineTo(size * wingSpan, torsoTop + size * 0.52);
      ctx.lineTo(size * 0.13, torsoBottom - size * 0.08);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(16, 35, 27, 0.66)";
    ctx.lineWidth = Math.max(1.1, size * 0.095);
    ctx.beginPath();
    ctx.moveTo(-size * 0.12, torsoTop + size * 0.2);
    ctx.lineTo(-size * armSpan, torsoTop + size * armDrop);
    ctx.moveTo(size * 0.12, torsoTop + size * 0.2);
    ctx.lineTo(size * armSpan, torsoTop + size * armDrop);

    if (bentLegs > 0) {
      const kneeY = torsoBottom + size * legDrop * 0.42;
      ctx.moveTo(-size * 0.08, torsoBottom);
      ctx.lineTo(-size * legSpan * 0.48, kneeY);
      ctx.lineTo(-size * legSpan, torsoBottom + size * legDrop - size * bentLegs * 0.18);
      ctx.moveTo(size * 0.08, torsoBottom);
      ctx.lineTo(size * legSpan * 0.48, kneeY);
      ctx.lineTo(size * legSpan, torsoBottom + size * legDrop - size * bentLegs * 0.18);
    } else {
      ctx.moveTo(-size * 0.08, torsoBottom);
      ctx.lineTo(-size * legSpan, torsoBottom + size * legDrop);
      ctx.moveTo(size * 0.08, torsoBottom);
      ctx.lineTo(size * legSpan, torsoBottom + size * legDrop);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(16, 35, 27, 0.86)";
    ctx.beginPath();
    ctx.arc(0, torsoTop - size * 0.22, size * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawSkydiverUnderCanopy = (skydiver, elapsed) => {
    const sway = Math.sin(elapsed * 0.001 + skydiver.driftOffset) * skydiver.drift * 0.42;
    const x = skydiver.x + sway;
    const y = skydiver.y;
    const size = skydiver.size;
    const inflation = skydiver.canopyInflation;
    const canopyWidth = size * (2.4 + inflation * 2.5);
    const canopyHeight = size * (0.5 + inflation * 1.1);
    const canopyY = y - size * (2.1 + inflation * 1.25);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const harnessY = y - size * 0.44;
    const lines = [-0.42, -0.16, 0.16, 0.42];
    ctx.strokeStyle = "rgba(16, 35, 27, 0.42)";
    ctx.lineWidth = Math.max(0.75, size * 0.065);
    for (const ratio of lines) {
      ctx.beginPath();
      ctx.moveTo(x + size * ratio * 0.56, harnessY);
      ctx.lineTo(x + canopyWidth * ratio, canopyY + canopyHeight * 0.36);
      ctx.stroke();
    }

    const canopyGradient = ctx.createLinearGradient(
      x,
      canopyY - canopyHeight,
      x,
      canopyY + canopyHeight * 0.7
    );
    canopyGradient.addColorStop(0, "rgba(255, 255, 255, 0.54)");
    canopyGradient.addColorStop(0.3, skydiver.canopyColor);
    canopyGradient.addColorStop(1, "rgba(16, 35, 27, 0.34)");

    ctx.fillStyle = canopyGradient;
    ctx.beginPath();
    ctx.moveTo(x - canopyWidth * 0.5, canopyY);
    ctx.quadraticCurveTo(x, canopyY - canopyHeight, x + canopyWidth * 0.5, canopyY);
    ctx.lineTo(x + canopyWidth * 0.42, canopyY + canopyHeight * 0.36);
    ctx.quadraticCurveTo(x, canopyY + canopyHeight * 0.58, x - canopyWidth * 0.42, canopyY + canopyHeight * 0.36);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.36)";
    ctx.lineWidth = Math.max(0.45, size * 0.05);
    for (let i = -2; i <= 2; i += 1) {
      const cellRatio = i / 5;
      const cellX = x + canopyWidth * cellRatio;
      ctx.beginPath();
      ctx.moveTo(cellX, canopyY + canopyHeight * 0.06);
      ctx.lineTo(x + canopyWidth * cellRatio * 0.92, canopyY + canopyHeight * 0.46);
      ctx.stroke();
    }
    ctx.restore();

    drawBodyPose(x, y, size * 0.95, skydiver.color, {
      rotation: Math.sin(elapsed * 0.0017 + skydiver.canopyTurnOffset) * 0.05,
      armSpan: 0.44,
      armDrop: 0.24,
      legSpan: 0.26,
      legDrop: 0.52,
      torsoLength: 0.92
    });
  };

  const drawSkydiver = (skydiver, elapsed) => {
    if (skydiver.canopyDeployed) {
      drawSkydiverUnderCanopy(skydiver, elapsed);
      return;
    }

    const sway = Math.sin(elapsed * 0.0012 + skydiver.driftOffset) * skydiver.drift;
    const x = skydiver.x + sway;
    const y = skydiver.y;
    const size = skydiver.size;
    const wobble = Math.sin(elapsed * 0.004 + skydiver.glideOffset) * 0.07;

    if (skydiver.jumpType === "freefall") {
      if (skydiver.freefallPose === "headdown") {
        drawBodyPose(x, y, size, skydiver.color, {
          rotation: Math.PI + wobble,
          armSpan: 0.58,
          armDrop: 0.24,
          legSpan: 0.27,
          legDrop: 0.42,
          torsoLength: 1
        });
        return;
      }

      if (skydiver.freefallPose === "sit") {
        drawBodyPose(x, y, size, skydiver.color, {
          rotation: wobble * 0.5,
          armSpan: 0.64,
          armDrop: 0.24,
          legSpan: 0.6,
          legDrop: 0.38,
          torsoLength: 0.94,
          bentLegs: 0.95
        });
        return;
      }

      drawBodyPose(x, y, size, skydiver.color, {
        rotation: wobble,
        armSpan: 0.74,
        armDrop: 0.26,
        legSpan: 0.34,
        legDrop: 0.52,
        torsoLength: 1
      });
      return;
    }

    if (skydiver.jumpType === "tracking") {
      drawBodyPose(x, y, size, skydiver.color, {
        rotation: skydiver.glideDirection * 0.55 + wobble * 0.4,
        armSpan: 0.9,
        armDrop: 0.22,
        legSpan: 0.7,
        legDrop: 0.58,
        torsoLength: 0.95
      });
      return;
    }

    if (skydiver.jumpType === "formation") {
      drawBodyPose(x, y, size, skydiver.color, {
        rotation: wobble * 0.35,
        armSpan: 1.02,
        armDrop: 0.14,
        legSpan: 0.84,
        legDrop: 0.56,
        torsoLength: 0.95
      });
      return;
    }

    drawBodyPose(x, y, size, skydiver.color, {
      rotation: skydiver.glideDirection * 0.26 + wobble * 0.45,
      armSpan: 1.08,
      armDrop: 0.12,
      legSpan: 0.58,
      legDrop: 0.62,
      torsoLength: 1.06,
      wingSpan: 1.04
    });
  };

  const deployCanopy = (skydiver) => {
    skydiver.canopyDeployed = true;
    skydiver.canopyInflation = 0.03;
    skydiver.vx *= 0.74;
    skydiver.vy = Math.min(skydiver.vy, random(44, 62));
  };

  const updateSkydiver = (skydiver, deltaSeconds, elapsed) => {
    skydiver.age += deltaSeconds;

    if (!skydiver.canopyDeployed) {
      const splitLineY = height * 0.5;

      if (skydiver.groupSize > 1 && !skydiver.hasSeparated && skydiver.y >= splitLineY) {
        skydiver.hasSeparated = true;
        skydiver.vx += skydiver.separationBurstX + skydiver.separationOffsetX * 0.32;
        skydiver.vy += skydiver.separationOffsetY * 0.16;
      }

      if (skydiver.groupSize > 1) {
        const targetX = skydiver.hasSeparated
          ? skydiver.groupAnchorX + skydiver.separationOffsetX
          : skydiver.groupAnchorX + skydiver.separationOffsetX * 0.12;
        const correction = clamp(targetX - skydiver.x, -72, 72);
        skydiver.vx += correction * deltaSeconds * (skydiver.hasSeparated ? 0.62 : 1.05);
      }

      const glideWave = Math.sin(elapsed * 0.0018 + skydiver.glideOffset) * 0.55 + 0.45;
      skydiver.vx += skydiver.glideStrength * skydiver.glideDirection * glideWave * deltaSeconds;
      skydiver.vy += skydiver.gravity * deltaSeconds;
      skydiver.vx *= skydiver.airDrag;
      skydiver.x += skydiver.vx * deltaSeconds;
      skydiver.y += skydiver.vy * deltaSeconds * freefallVerticalSpeedMultiplier;

      if (skydiver.y >= skydiver.deployAtY) {
        deployCanopy(skydiver);
      }

      return;
    }

    skydiver.canopyInflation = Math.min(1, skydiver.canopyInflation + deltaSeconds * 2.1);
    const canopyTurn = Math.sin(elapsed * 0.0014 + skydiver.canopyTurnOffset);
    skydiver.vx += canopyTurn * skydiver.canopySteer * deltaSeconds;
    skydiver.vy += skydiver.canopySink * deltaSeconds * 0.22;
    skydiver.vx *= 0.94;
    skydiver.vy *= skydiver.canopyDrag - skydiver.canopyInflation * 0.05;
    skydiver.vy = clamp(skydiver.vy, 24, 92);
    skydiver.x += skydiver.vx * deltaSeconds;
    skydiver.y += skydiver.vy * deltaSeconds * canopyVerticalSpeedMultiplier;
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

    const canopyWidth = size * 4.4;
    const canopyDepth = size * 0.95;
    const canopyTopY = -size * 2.15;
    const canopyBottomY = canopyTopY + canopyDepth;
    const canopyArcY = canopyTopY - canopyDepth * 0.55;
    const bodyOffsetY = size * 1.45;
    const riserY = -size * 0.5 + bodyOffsetY;

    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    ctx.ellipse(0, canopyBottomY + size * 0.38, canopyWidth * 0.42, size * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    const canopyGradient = ctx.createLinearGradient(0, canopyArcY, 0, canopyBottomY + size * 0.55);
    canopyGradient.addColorStop(0, "rgba(255, 255, 255, 0.62)");
    canopyGradient.addColorStop(0.3, swooper.color);
    canopyGradient.addColorStop(1, "rgba(17, 26, 36, 0.82)");
    ctx.fillStyle = canopyGradient;
    ctx.beginPath();
    ctx.moveTo(-canopyWidth * 0.5, canopyBottomY);
    ctx.quadraticCurveTo(0, canopyArcY, canopyWidth * 0.5, canopyBottomY);
    ctx.lineTo(canopyWidth * 0.44, canopyBottomY + size * 0.34);
    ctx.quadraticCurveTo(0, canopyBottomY + size * 0.62, -canopyWidth * 0.44, canopyBottomY + size * 0.34);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(22, 28, 34, 0.58)";
    ctx.lineWidth = Math.max(1.05, size * 0.085);
    ctx.beginPath();
    ctx.moveTo(-canopyWidth * 0.5, canopyBottomY);
    ctx.quadraticCurveTo(0, canopyArcY, canopyWidth * 0.5, canopyBottomY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.lineWidth = Math.max(0.65, size * 0.055);
    for (let i = -3; i <= 3; i += 1) {
      const ratio = i / 6;
      ctx.beginPath();
      ctx.moveTo(canopyWidth * ratio, canopyBottomY + size * 0.06);
      ctx.lineTo(canopyWidth * ratio * 0.9, canopyBottomY + size * 0.44);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(16, 20, 26, 0.54)";
    ctx.lineWidth = Math.max(0.75, size * 0.06);
    const lineRatios = [-0.42, -0.2, 0.2, 0.42];
    for (const ratio of lineRatios) {
      ctx.beginPath();
      ctx.moveTo(size * ratio * 0.7, riserY);
      ctx.lineTo(canopyWidth * ratio, canopyBottomY + size * 0.3);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(35, 46, 60, 0.96)";
    roundedRectPath(
      -size * 0.16,
      -size * 0.62 + bodyOffsetY,
      size * 0.32,
      size * 0.75,
      size * 0.12
    );
    ctx.fill();

    ctx.strokeStyle = "rgba(228, 234, 240, 0.56)";
    ctx.lineWidth = Math.max(0.75, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(-size * 0.11, -size * 0.52 + bodyOffsetY);
    ctx.lineTo(-size * 0.02, size * 0.08 + bodyOffsetY);
    ctx.moveTo(size * 0.11, -size * 0.52 + bodyOffsetY);
    ctx.lineTo(size * 0.02, size * 0.08 + bodyOffsetY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(15, 21, 29, 0.82)";
    ctx.lineWidth = Math.max(1, size * 0.09);
    const armAngleFromUp = (20 * Math.PI) / 180;
    const armLength = size * 0.52;
    const armDx = Math.sin(armAngleFromUp) * armLength;
    const armDy = Math.cos(armAngleFromUp) * armLength;
    const leftShoulderX = -size * 0.13;
    const rightShoulderX = size * 0.13;
    const shoulderY = -size * 0.28 + bodyOffsetY;
    ctx.beginPath();
    ctx.moveTo(leftShoulderX, shoulderY);
    ctx.lineTo(leftShoulderX - armDx, shoulderY - armDy);
    ctx.moveTo(rightShoulderX, shoulderY);
    ctx.lineTo(rightShoulderX + armDx, shoulderY - armDy);
    ctx.moveTo(-size * 0.06, size * 0.12 + bodyOffsetY);
    ctx.lineTo(-size * 0.34, size * 0.66 + bodyOffsetY);
    ctx.moveTo(size * 0.06, size * 0.12 + bodyOffsetY);
    ctx.lineTo(size * 0.37, size * 0.62 + bodyOffsetY);
    ctx.stroke();

    ctx.fillStyle = "rgba(30, 39, 50, 0.95)";
    ctx.beginPath();
    ctx.arc(0, -size * 0.87 + bodyOffsetY, size * 0.24, 0, Math.PI * 2);
    ctx.fill();

    const faceY = -size * 0.87 + bodyOffsetY;
    ctx.strokeStyle = "rgba(230, 236, 244, 0.42)";
    ctx.lineWidth = Math.max(0.55, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(-size * 0.08, faceY - size * 0.08);
    ctx.lineTo(size * 0.1, faceY - size * 0.03);
    ctx.moveTo(-size * 0.06, faceY + size * 0.08);
    ctx.lineTo(size * 0.06, faceY + size * 0.08);
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

    if (plane && !pendingSkydiverRun && plane.angle >= nextSkydiverBatchAtAngle) {
      pendingSkydiverRun = createSkydiverRun();
      nextSkydiverDropIn = random(0.16, 0.62);
    }

    if (pendingSkydiverRun) {
      const currentGroup = pendingSkydiverRun.groups[pendingSkydiverRun.groupIndex];

      if (!currentGroup) {
        pendingSkydiverRun = null;
        scheduleNextSkydiverBatch();
      } else {
        nextSkydiverDropIn -= deltaSeconds;
        if (nextSkydiverDropIn <= 0) {
          if (plane && skydivers.length < 28) {
            const memberIndex = currentGroup.size - currentGroup.membersLeft;
            skydivers.push(createSkydiverFromPlane(plane, currentGroup, memberIndex));
            currentGroup.membersLeft -= 1;

            if (currentGroup.membersLeft <= 0) {
              pendingSkydiverRun.groupIndex += 1;
              const hasMoreGroups = pendingSkydiverRun.groupIndex < pendingSkydiverRun.groups.length;

              if (hasMoreGroups) {
                // For runs split into multiple groups, wait at least 3 seconds before the next group.
                nextSkydiverDropIn = random(3, 4.8);
              } else {
                pendingSkydiverRun = null;
                scheduleNextSkydiverBatch();
              }
            } else {
              nextSkydiverDropIn = random(0.1, 0.28);
            }
          } else {
            nextSkydiverDropIn = 0.3;
          }
        }
      }
    }

    for (let i = skydivers.length - 1; i >= 0; i -= 1) {
      const skydiver = skydivers[i];
      updateSkydiver(skydiver, deltaSeconds, timestamp);
      drawSkydiver(skydiver, timestamp);

      const horizontalSize = skydiver.canopyDeployed ? skydiver.size * 3.4 : skydiver.size;
      const outBottom = skydiver.y - skydiver.size > height + 64;
      const outLeft = skydiver.x + horizontalSize < -60;
      const outRight = skydiver.x - horizontalSize > width + 60;
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

  const setAnimationsEnabled = (enabled, { persist = false } = {}) => {
    animationsEnabled = Boolean(enabled);
    syncAnimationsToggle(animationsEnabled);

    if (persist) {
      viewerConfig = {
        ...viewerConfig,
        animationsEnabled
      };
      writeViewerConfig(viewerConfig);
    }

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

  viewerConfig = readViewerConfig();
  resize();
  setAnimationsEnabled(viewerConfig.animationsEnabled);

  if (animationsToggleEl) {
    animationsToggleEl.addEventListener("change", () => {
      setAnimationsEnabled(animationsToggleEl.checked, { persist: true });
    });
  }

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
