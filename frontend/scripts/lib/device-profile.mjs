// 设备档位：视口 + 触摸 + 像素比 + 横竖屏。
//
// 审计与截图脚本此前一律用「桌面 Chromium 把视口缩窄」—— 那样量到的
// 只是几何，碰不到真手机上的三件事：触摸设备没有悬停、像素密度不是 1、
// 横竖屏是两套版式。这个模块把「设备档位」统一成一处，各脚本共用。
//
// 环境变量：
//   LG_TOUCH=1        开启触摸仿真。hasTouch 会把 (hover: hover) 与
//                     (pointer: fine) 翻成触摸态，且不改变视口宽度
//                     —— 审计要 390 就拿到 390，不必迁就 meta viewport。
//   LG_DPR=3          设备像素比。默认：触摸档 3，桌面档 1。
//   LG_ORIENTATION    portrait | landscape | both（默认 portrait）。
//                     横屏是另起一档宽高互换的视口，不是把同一个视口
//                     旋转：阅读器按 100dvh 排、足迹页地图按 vh 压扁，
//                     横竖屏本来就是两套版式，要各量一遍。

/**
 * 把视口展开成设备档位。
 *
 * @param {object} options
 * @param {{width: number, height: number}[]} options.viewports 基础视口
 * @param {boolean} options.touch 是否触摸仿真
 * @param {number|undefined} options.dpr 设备像素比（不给则按触摸与否取默认）
 * @param {"portrait"|"landscape"|"both"} options.orientation 横竖屏
 * @returns {{label: string, viewport: {width: number, height: number}, hasTouch: boolean, deviceScaleFactor: number}[]}
 */
export function resolveProfiles({
  viewports,
  touch,
  dpr,
  orientation = "portrait",
}) {
  const profiles = [];
  for (const viewport of viewports) {
    profiles.push(makeProfile(viewport, touch, dpr, "portrait"));
    if (orientation === "landscape" || orientation === "both") {
      profiles.push(
        makeProfile(
          { width: viewport.height, height: viewport.width },
          touch,
          dpr,
          "landscape",
        ),
      );
    }
  }
  return profiles;
}

function makeProfile(viewport, touch, dpr, orientation) {
  const hasTouch = Boolean(touch);
  return {
    label: profileLabel(viewport, hasTouch, orientation),
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch,
    deviceScaleFactor:
      typeof dpr === "number" && Number.isFinite(dpr) ? dpr : hasTouch ? 3 : 1,
  };
}

/**
 * 档位标签：断点 + 触摸 + 横屏。
 *
 * 标签要能区分同一尺寸下的不同设备档 —— 审计按标签分组做跨页对齐
 * 比较，触摸档与桌面档混在一组会比出假的不一致。
 */
function profileLabel(viewport, hasTouch, orientation) {
  const size = `${viewport.width}x${viewport.height}`;
  if (hasTouch && orientation === "landscape") return `${size}-touch-l`;
  if (hasTouch) return `${size}-touch`;
  if (orientation === "landscape") return `${size}-l`;
  return size;
}

/** 从环境变量读出档位参数。 */
export function profileOptionsFromEnv(env = process.env) {
  return {
    touch: env.LG_TOUCH === "1" || env.LG_TOUCH === "true",
    dpr: env.LG_DPR ? Number(env.LG_DPR) : undefined,
    orientation: env.LG_ORIENTATION ?? "portrait",
  };
}
