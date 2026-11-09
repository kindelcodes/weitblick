// PowerPoint (.pptx): Export und Import.
//
// Export: jeder Pfadschritt wird eine Folie. Im Morph-Modus liegt auf jeder Folie die ganze Leinwand,
// so verschoben und skaliert, wie die Kamera bei diesem Schritt steht; gleich benannte Objekte („!!id“)
// lässt PowerPoints Übergang „Morph“ dann von Folie zu Folie gleiten – wie die Kamerafahrt in Weitblick.
// Im klassischen Modus enthält jede Folie nur, was im Ausschnitt liegt, ohne Übergang.
//
// Import: jede Folie wird ein Rahmen auf der Leinwand (im Raster angeordnet) und ein Pfadschritt.
// Übernommen werden Textfelder, Bilder, Standardformen, Linien, Tabellentext und Hintergrundfarben.

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SLIDE_W = 12192000; // EMU, 13,333 Zoll wie PowerPoints 16:9
const EMU_PER_PT = 12700;
const MAX_EMU = 2_000_000_000;

// Weitblick-Form → PowerPoint-Vorlage. Was hier fehlt, wird als Bild eingebettet.
const PRESET = {
  rect: "rect",
  rounded: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  "right-triangle": "rtTriangle",
  parallelogram: "parallelogram",
  trapezoid: "trapezoid",
  diamond: "diamond",
  pentagon: "pentagon",
  hexagon: "hexagon",
  heptagon: "heptagon",
  octagon: "octagon",
  star: "star5",
  sparkle: "star4",
  burst: "star12",
  plus: "plus",
  heart: "heart",
  moon: "moon",
  cloud: "cloud",
  arrow: "rightArrow",
  "arrow-left": "leftArrow",
  "arrow-both": "leftRightArrow",
  "arrow-flag": "homePlate",
  chevron: "chevron",
  cylinder: "can",
  document: "flowChartDocument",
  manual: "flowChartManualInput",
  gear: "gear6",
  drop: "teardrop",
  bubble: "wedgeRoundRectCallout",
  "bubble-round": "wedgeEllipseCallout",
  line: "rect",
  "line-arrow": "rightArrow",
  ring: "donut",
};

// Rückweg beim Import; mehrere PowerPoint-Vorlagen landen auf derselben Weitblick-Form.
const FROM_PRESET = {
  ...Object.fromEntries(Object.entries(PRESET).filter(([k]) => !["line", "line-arrow", "rounded"].includes(k)).map(([k, v]) => [v, k])),
  roundRect: "rounded",
  snip1Rect: "rect",
  flowChartProcess: "rect",
  flowChartAlternateProcess: "rounded",
  flowChartDecision: "diamond",
  flowChartTerminator: "rounded",
  flowChartConnector: "ellipse",
  flowChartMagneticDisk: "cylinder",
  star6: "star",
  star7: "star",
  star8: "star",
  star10: "burst",
  star16: "burst",
  star24: "burst",
  star32: "burst",
  rightArrowCallout: "arrow",
  notchedRightArrow: "arrow",
  wedgeRectCallout: "bubble",
  cloudCallout: "bubble-round",
};

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const hex6 = (c) => (/^#?[0-9a-f]{6}$/i.test(c ?? "") ? c.replace("#", "").toUpperCase() : "888888");
const emu = (v) => Math.round(Math.max(-MAX_EMU, Math.min(MAX_EMU, v)));
const size = (v) => Math.max(1, Math.round(Math.min(MAX_EMU, v)));

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_DECL = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const EMPTY_GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

// ======================================================================
// Export
// ======================================================================

// SVG (Symbol, Weltkarte, Sonderform) über ein Canvas in ein PNG verwandeln.
function rasterize(svg, w, h) {
  const px = 1024;
  const cw = w >= h ? px : Math.max(8, Math.round((px * w) / h));
  const ch = h >= w ? px : Math.max(8, Math.round((px * h) / w));
  const src = svg.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" `);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      c.getContext("2d").drawImage(img, 0, 0, cw, ch);
      resolve(c.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = () => reject(new Error("Grafik konnte nicht umgewandelt werden."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  });
}

// Bilder, die PowerPoint nicht sicher kann (WebP, SVG, BMP), als PNG neu zeichnen.
function reencode(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 512;
      c.height = img.naturalHeight || 512;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = () => reject(new Error("Bild konnte nicht umgewandelt werden."));
    img.src = url;
  });
}

// Echte Schriftnamen für die festen Weitblick-Schriften.
function realFont(f) {
  return { sans: "Segoe UI", serif: "Georgia", mono: "Consolas", "Weitblick Brand": "Comfortaa" }[f] ?? f;
}

function txBody(o, ctx, scale) {
  const pt = Math.max(1, Math.min(4000, (o.size * scale) / EMU_PER_PT));
  const sz = Math.round(pt * 100);
  const color = hex6(o.color ?? ctx.doc.theme.text);
  const font = esc(realFont(ctx.textFont(o)));
  const b = ctx.textWeight(o) >= 600 ? ' b="1"' : "";
  const i = ctx.textItalic(o) ? ' i="1"' : "";
  const algn = { center: "ctr", right: "r" }[o.align] ?? "l";
  const rPr = `<a:rPr lang="de-DE" sz="${sz}"${b}${i} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:rPr>`;
  const paras = String(o.text ?? "")
    .split("\n")
    .map((line) =>
      line
        ? `<a:p><a:pPr algn="${algn}"/><a:r>${rPr}<a:t>${esc(line)}</a:t></a:r></a:p>`
        : `<a:p><a:pPr algn="${algn}"/><a:endParaRPr lang="de-DE" sz="${sz}"/></a:p>`,
    )
    .join("");
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody>`;
}

function xfrm(r, rot) {
  const rotAttr = rot ? ` rot="${Math.round(rot * 60000) % 21600000}"` : "";
  return `<a:xfrm${rotAttr}><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${size(r.w)}" cy="${size(r.h)}"/></a:xfrm>`;
}

function solid(color, opacity) {
  const alpha = opacity != null && opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : "";
  return `<a:solidFill><a:srgbClr val="${hex6(color)}">${alpha}</a:srgbClr></a:solidFill>`;
}

// Verlauf von oben nach unten in einer Farbe, mit Deckkraft fade[0] → fade[1].
function fadeFill(color, fade) {
  const stop = (pos, a) => `<a:gs pos="${pos}"><a:srgbClr val="${hex6(color)}"><a:alpha val="${Math.round(a * 100000)}"/></a:srgbClr></a:gs>`;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stop(0, fade[0])}${stop(100000, fade[1])}</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`;
}

function spXml(id, name, r, rot, geom, fill, body, isText) {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr${isText ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(r, rot)}${geom}${fill}<a:ln><a:noFill/></a:ln></p:spPr>${body ?? ""}</p:sp>`
  );
}

function picXml(id, name, rId, r, rot, opacity, rounded, crop) {
  const alpha = opacity != null && opacity < 1 ? `<a:alphaModFix amt="${Math.round(opacity * 100000)}"/>` : "";
  const geom = rounded ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${rounded}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const pct = (v) => Math.round(v * 100000);
  const src = crop ? `<a:srcRect l="${pct(crop.x)}" t="${pct(crop.y)}" r="${pct(1 - crop.x - crop.w)}" b="${pct(1 - crop.y - crop.h)}"/>` : "";
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rId}">${alpha}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(r, rot)}${geom}</p:spPr></p:pic>`
  );
}

function geomFor(o, ctx) {
  const prst = PRESET[o.shape];
  const r = ctx.hasCorners(o) ? ctx.cornerRadius(o) : 0;
  if ((o.shape === "rect" || o.shape === "rounded") && r > 0) {
    return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(r * 1000)}"/></a:avLst></a:prstGeom>`;
  }
  if (o.shape === "ring") return '<a:prstGeom prst="donut"><a:avLst><a:gd name="adj" fmla="val 2500"/></a:avLst></a:prstGeom>';
  return `<a:prstGeom prst="${prst === "roundRect" ? "rect" : prst}"><a:avLst/></a:prstGeom>`;
}

// ctx: { doc, media, steps: [{ rect, hidden:Set }], morph, aspect, textFont, textWeight, textItalic,
//        cornerRadius, hasCorners, shapeSvg, iconSvg, onProgress }
export async function buildPptx(ctx) {
  const { doc, media, steps, morph, aspect } = ctx;
  const slideH = Math.round(SLIDE_W / aspect);
  const files = [];
  const mediaFiles = new Map(); // Schlüssel → Dateiname in ppt/media
  let mediaCount = 0;

  // Bild einmal ablegen, egal auf wie vielen Folien es vorkommt.
  async function mediaFor(key, make) {
    if (!mediaFiles.has(key)) {
      const { data, ext } = await make();
      const name = `image${++mediaCount}.${ext}`;
      files.push({ name: `ppt/media/${name}`, data });
      mediaFiles.set(key, name);
    }
    return mediaFiles.get(key);
  }

  async function imageMedia(src) {
    return mediaFor(`img:${src}`, async () => {
      const m = media.get(src);
      const ext = src.split(".").pop().toLowerCase();
      if (["png", "jpg", "jpeg", "gif"].includes(ext)) return { data: m.data, ext: ext === "jpg" ? "jpeg" : ext };
      return { data: await reencode(m.url), ext: "png" };
    });
  }

  const bg = doc.background?.src && media.get(doc.background.src) ? doc.background.src : null;
  const slides = [];

  for (let si = 0; si < steps.length; si++) {
    ctx.onProgress?.(si + 1, steps.length);
    const { rect, hidden } = steps[si];
    // Kamera wie beim Präsentieren: Rahmen mit 8 % Rand ins Folienformat eingepasst.
    const camW = Math.max(rect.w, rect.h * aspect) * 1.16;
    const camH = camW / aspect;
    const ox = rect.x + rect.w / 2 - camW / 2;
    const oy = rect.y + rect.h / 2 - camH / 2;
    const scale = SLIDE_W / camW;
    const map = (o) => ({ x: (o.x - ox) * scale, y: (o.y - oy) * scale, w: o.w * scale, h: o.h * scale });
    const onSlide = (r, margin) => r.x + r.w > -margin * SLIDE_W && r.x < (1 + margin) * SLIDE_W && r.y + r.h > -margin * slideH && r.y < (1 + margin) * slideH;

    const rels = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    const relFor = new Map();
    const rid = (target) => {
      if (!relFor.has(target)) {
        const id = `rId${rels.length + 1}`;
        rels.push(`<Relationship Id="${id}" Type="${REL}/image" Target="../media/${target}"/>`);
        relFor.set(target, id);
      }
      return relFor.get(target);
    };

    let shapes = "";
    let nextId = 2;
    for (const o of doc.objects) {
      if (o.hidden || hidden.has(o.id)) continue;
      const r = map(o);
      // Morph braucht auch Objekte knapp außerhalb (sie gleiten herein), aber nicht die halbe Welt.
      if (!onSlide(r, morph ? 2 : 0)) continue;
      const name = morph ? `!!${o.id}` : o.id;
      const rot = o.rot ?? 0;
      const id = nextId++;
      if (o.type === "text") {
        shapes += spXml(id, name, r, rot, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', "<a:noFill/>", txBody(o, ctx, scale), true);
      } else if (o.type === "shape" && PRESET[o.shape] && !o.points) {
        shapes += spXml(id, name, r, rot, geomFor(o, ctx), o.fade ? fadeFill(o.fill, o.fade) : solid(o.fill, o.opacity), null, false);
      } else if (o.type === "shape" || o.type === "icon") {
        const svg = o.type === "icon" ? ctx.iconSvg(o.name).replace(/currentColor/g, `#${hex6(o.color ?? doc.theme.text)}`) : ctx.shapeSvg(o.shape, o.fill, o.points, ctx.hasCorners(o) ? ctx.cornerRadius(o) : 0);
        if (!svg) continue;
        const file = await mediaFor(`svg:${o.id}:${o.w.toFixed(1)}x${o.h.toFixed(1)}:${o.fill ?? o.color}`, async () => ({ data: await rasterize(svg, o.w, o.h), ext: "png" }));
        shapes += picXml(id, name, rid(file), r, rot, o.opacity, 0);
      } else if (o.type === "image" && media.get(o.src)) {
        const file = await imageMedia(o.src);
        const rr = ctx.hasCorners(o) ? Math.round(ctx.cornerRadius(o) * 1000) : 0;
        shapes += picXml(id, name, rid(file), r, rot, o.opacity, rr, o.crop);
      } else if (o.type === "frame" && o.fill) {
        shapes += spXml(id, name, r, rot, geomFor({ ...o, shape: "rect" }, ctx), solid(o.fill), null, false);
      }
    }

    let bgXml = `<p:bg><p:bgPr>${solid(doc.theme.background)}<a:effectLst/></p:bgPr></p:bg>`;
    if (bg) {
      const file = await imageMedia(bg);
      bgXml = `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid(file)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
    }
    const transition =
      morph && si > 0
        ? '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>'
        : "";
    slides.push({
      xml: `${XML_HEAD}<p:sld ${NS_DECL}><p:cSld>${bgXml}<p:spTree>${EMPTY_GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}</p:sld>`,
      rels: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
    });
  }

  slides.forEach((s, i) => {
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, text: s.xml });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, text: s.rels });
  });
  files.push(...packageParts(doc, slides.length, slideH));
  return files;
}

function packageParts(doc, count, slideH) {
  const range = [...Array(count).keys()];
  const t = doc.theme;
  const fonts = t.fonts ?? {};
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const relsDoc = (rels) =>
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  return [
    {
      name: "[Content_Types].xml",
      text:
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>' +
        '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>' +
        '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        range.map((i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      text: relsDoc(
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>` +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>`,
      ),
    },
    {
      name: "docProps/core.xml",
      text:
        `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${esc(doc.title)}</dc:title><dc:creator>Weitblick</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      text: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Weitblick</Application><Slides>${count}</Slides></Properties>`,
    },
    {
      name: "ppt/presentation.xml",
      text:
        `${XML_HEAD}<p:presentation ${NS_DECL} saveSubsetFonts="1">` +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        `<p:sldIdLst>${range.map((i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join("")}</p:sldIdLst>` +
        `<p:sldSz cx="${SLIDE_W}" cy="${slideH}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      text: relsDoc(
        `<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
          `<Relationship Id="rId2" Type="${REL}/theme" Target="theme/theme1.xml"/>` +
          `<Relationship Id="rId3" Type="${REL}/presProps" Target="presProps.xml"/>` +
          `<Relationship Id="rId4" Type="${REL}/viewProps" Target="viewProps.xml"/>` +
          `<Relationship Id="rId5" Type="${REL}/tableStyles" Target="tableStyles.xml"/>` +
          range.map((i) => `<Relationship Id="rId${10 + i}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join(""),
      ),
    },
    { name: "ppt/presProps.xml", text: `${XML_HEAD}<p:presentationPr ${NS_DECL}/>` },
    {
      name: "ppt/viewProps.xml",
      text: `${XML_HEAD}<p:viewPr ${NS_DECL}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
    },
    {
      name: "ppt/tableStyles.xml",
      text: `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      text:
        `${XML_HEAD}<p:sldMaster ${NS_DECL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_GROUP}</p:spTree></p:cSld>` +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
        '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>',
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      text: relsDoc(
        `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/>`,
      ),
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      text: `${XML_HEAD}<p:sldLayout ${NS_DECL} type="blank" preserve="1"><p:cSld name="Leer"><p:spTree>${EMPTY_GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      text: relsDoc(`<Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`),
    },
    { name: "ppt/theme/theme1.xml", text: themeXml(t, fonts) },
  ];
}

function themeXml(t, fonts) {
  const c = (v) => `<a:srgbClr val="${hex6(v)}"/>`;
  const fill = (n) => `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`.repeat(n);
  const ln = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
  return (
    `${XML_HEAD}<a:theme xmlns:a="${NS.a}" name="Weitblick"><a:themeElements>` +
    `<a:clrScheme name="Weitblick"><a:dk1>${c(t.text)}</a:dk1><a:lt1>${c(t.background)}</a:lt1><a:dk2>${c(t.text)}</a:dk2><a:lt2>${c(t.background)}</a:lt2>` +
    `<a:accent1>${c(t.accent)}</a:accent1><a:accent2>${c(t.accent2 ?? t.accent)}</a:accent2><a:accent3>${c("#888888")}</a:accent3><a:accent4>${c("#5B9BD5")}</a:accent4>` +
    `<a:accent5>${c("#70AD47")}</a:accent5><a:accent6>${c("#ED7D31")}</a:accent6><a:hlink>${c(t.accent)}</a:hlink><a:folHlink>${c(t.accent2 ?? t.accent)}</a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Weitblick"><a:majorFont><a:latin typeface="${esc(realFont(fonts.title ?? "sans"))}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${esc(realFont(fonts.body ?? "sans"))}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Weitblick"><a:fillStyleLst>${fill(3)}</a:fillStyleLst><a:lnStyleLst>${ln}${ln}${ln}</a:lnStyleLst>` +
    "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
    `<a:bgFillStyleLst>${fill(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  );
}

// ======================================================================
// Import
// ======================================================================

const UNITS_PER_SLIDE = 1600; // Breite einer importierten Folie auf der Leinwand

function parseXml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

// Kinder/Nachfahren über den lokalen Namen finden (Präfixe sind in PPTX-Dateien nicht immer gleich).
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] ?? null;
const desc = (el, name) => (el ? [...el.getElementsByTagNameNS("*", name)] : []);
const num = (v, d = 0) => (v == null || v === "" ? d : Number(v));

function resolvePath(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relsOf(files, part) {
  const dir = part.split("/").slice(0, -1).join("/");
  const name = part.split("/").pop();
  const text = files.get(`${dir}/_rels/${name}.rels`)?.text;
  const map = new Map();
  if (!text) return map;
  for (const r of desc(parseXml(text).documentElement, "Relationship")) {
    map.set(r.getAttribute("Id"), { type: r.getAttribute("Type").split("/").pop(), target: resolvePath(part, r.getAttribute("Target")) });
  }
  return map;
}

// HSL-Helligkeit für lumMod/lumOff anpassen.
function adjustLum(hex, mod, off) {
  const n = parseInt(hex, 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.max(0, Math.min(1, l * mod + off));
  const f = (p, q, t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    [r, g, b] = [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)];
  }
  return [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

function readTheme(files, part) {
  const doc = parseXml(files.get(part)?.text ?? "<x/>");
  const scheme = desc(doc.documentElement, "clrScheme")[0];
  const colors = {};
  for (const el of scheme ? [...scheme.children] : []) {
    const c = el.firstElementChild;
    colors[el.localName] = c?.getAttribute("val") && c.localName === "srgbClr" ? c.getAttribute("val") : (c?.getAttribute("lastClr") ?? "000000");
  }
  const font = (n) => desc(desc(doc.documentElement, n)[0], "latin")[0]?.getAttribute("typeface") || null;
  return { colors, major: font("majorFont"), minor: font("minorFont") };
}

// Farbe aus einem Element mit srgbClr/schemeClr/sysClr als Kind (oder es selbst).
function colorOf(el, theme) {
  if (!el) return null;
  const c = ["srgbClr", "schemeClr", "sysClr", "prstClr"].includes(el.localName) ? el : [...el.children].find((x) => ["srgbClr", "schemeClr", "sysClr", "prstClr"].includes(x.localName));
  if (!c) return null;
  let hex;
  if (c.localName === "srgbClr") hex = c.getAttribute("val");
  else if (c.localName === "sysClr") hex = c.getAttribute("lastClr") ?? "000000";
  else if (c.localName === "prstClr") hex = { black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "00FF00" }[c.getAttribute("val")] ?? "000000";
  else {
    const key = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" }[c.getAttribute("val")] ?? c.getAttribute("val");
    hex = theme.colors[key] ?? "000000";
  }
  const mod = kid(c, "lumMod");
  const off = kid(c, "lumOff");
  if (mod || off) hex = adjustLum(hex, num(mod?.getAttribute("val"), 100000) / 100000, num(off?.getAttribute("val"), 0) / 100000);
  return `#${hex.toLowerCase()}`;
}

// Platzhalter (Titel, Inhalt) übernehmen Lage und Größe aus Layout bzw. Master.
function placeholderXfrm(ph, layoutTree, masterTree) {
  const type = ph.getAttribute("type") ?? "body";
  const idx = ph.getAttribute("idx");
  const same = (t) => (type === "title" || type === "ctrTitle" ? t === "title" || t === "ctrTitle" : t === type);
  for (const tree of [layoutTree, masterTree]) {
    if (!tree) continue;
    const cands = desc(tree, "sp").filter((sp) => desc(sp, "ph")[0]);
    const hit =
      cands.find((sp) => idx != null && desc(sp, "ph")[0].getAttribute("idx") === idx) ??
      cands.find((sp) => same(desc(sp, "ph")[0].getAttribute("type") ?? "body"));
    const x = hit && kid(kid(hit, "spPr"), "xfrm");
    if (x) return x;
  }
  return null;
}

function readXfrm(x) {
  if (!x) return null;
  const off = kid(x, "off");
  const ext = kid(x, "ext");
  return {
    x: num(off?.getAttribute("x")),
    y: num(off?.getAttribute("y")),
    w: num(ext?.getAttribute("cx")),
    h: num(ext?.getAttribute("cy")),
    rot: num(x.getAttribute("rot")) / 60000,
    flipH: x.getAttribute("flipH") === "1",
    flipV: x.getAttribute("flipV") === "1",
  };
}

// Text eines txBody mit den Angaben des ersten Laufs.
function readText(body, theme, defaults) {
  if (!body) return null;
  const paras = kids(body, "p");
  const lines = paras.map((p) => [...p.children].filter((c) => c.localName === "r" || c.localName === "fld").map((r) => kid(r, "t")?.textContent ?? "").join("") + (kids(p, "br").length ? "" : ""));
  const text = lines.join("\n").replace(/\n+$/, "");
  if (!text.trim()) return null;
  const firstRun = desc(body, "r")[0];
  const rPr = kid(firstRun, "rPr") ?? desc(body, "endParaRPr")[0] ?? desc(body, "defRPr")[0];
  const algn = desc(body, "pPr")[0]?.getAttribute("algn");
  // „Text bei Überlauf verkleinern“: PowerPoint speichert den Faktor in normAutofit@fontScale.
  const scale = num(desc(body, "normAutofit")[0]?.getAttribute("fontScale"), 100000) / 100000;
  return {
    text,
    pt: (rPr?.getAttribute("sz") ? num(rPr.getAttribute("sz")) / 100 : defaults.pt) * scale,
    bold: rPr?.getAttribute("b") === "1" || (rPr?.getAttribute("b") == null && defaults.bold),
    italic: rPr?.getAttribute("i") === "1",
    color: colorOf(kid(rPr, "solidFill"), theme) ?? defaults.color,
    font: kid(rPr, "latin")?.getAttribute("typeface")?.replace(/^\+mj-lt$/, defaults.major ?? "").replace(/^\+mn-lt$/, defaults.minor ?? "") || null,
    align: { ctr: "center", r: "right" }[algn] ?? "left",
  };
}

// entries: Ausgabe von read_zip. Liefert { doc, media: [{name, data}], skipped }.
export function importPptx(entries, title, baseTheme) {
  const files = new Map(entries.map((e) => [e.name, e]));
  const presPart = "ppt/presentation.xml";
  const pres = parseXml(files.get(presPart)?.text ?? "");
  if (!pres.documentElement || pres.documentElement.localName !== "presentation") throw new Error("Das ist keine PowerPoint-Präsentation.");
  const sz = desc(pres.documentElement, "sldSz")[0];
  const sw = num(sz?.getAttribute("cx"), 12192000);
  const sh = num(sz?.getAttribute("cy"), 6858000);
  const k = UNITS_PER_SLIDE / sw; // Leinwand-Einheiten pro EMU
  const presRels = relsOf(files, presPart);
  const themeRel = [...presRels.values()].find((r) => r.type === "theme");
  const theme = readTheme(files, themeRel?.target ?? "ppt/theme/theme1.xml");
  const slideParts = desc(pres.documentElement, "sldId").map((s) => presRels.get(s.getAttributeNS(NS.r, "id") ?? s.getAttribute("r:id"))?.target).filter(Boolean);

  const objects = [];
  const path = [];
  const media = [];
  const skipped = new Set();
  let n = 0;
  const id = (p) => `${p}-pp${++n}`;
  const cols = Math.max(1, Math.ceil(Math.sqrt(slideParts.length)));
  const gap = UNITS_PER_SLIDE * 0.15;
  const fw = UNITS_PER_SLIDE;
  const fh = sh * k;
  const dark = theme.colors.dk1 ? `#${theme.colors.dk1}` : "#000000";

  slideParts.forEach((part, si) => {
    const slide = parseXml(files.get(part)?.text ?? "<x/>").documentElement;
    const rels = relsOf(files, part);
    const layoutPart = [...rels.values()].find((r) => r.type === "slideLayout")?.target;
    const layout = layoutPart ? parseXml(files.get(layoutPart)?.text ?? "<x/>").documentElement : null;
    const masterPart = layoutPart ? [...relsOf(files, layoutPart).values()].find((r) => r.type === "slideMaster")?.target : null;
    const master = masterPart ? parseXml(files.get(masterPart)?.text ?? "<x/>").documentElement : null;
    const fx = (si % cols) * (fw + gap);
    const fy = Math.floor(si / cols) * (fh + gap);

    // Hintergrund: Folie, sonst Layout, sonst Master, sonst Designfarbe lt1.
    let bgColor = null;
    for (const src of [slide, layout, master]) {
      const bgPr = desc(src, "bgPr")[0];
      const ref = desc(src, "bgRef")[0];
      bgColor = colorOf(kid(bgPr, "solidFill"), theme) ?? colorOf(ref, theme);
      if (bgColor) break;
    }
    const frame = { id: id("f"), type: "frame", x: fx, y: fy, w: fw, h: fh, title: `Folie ${si + 1}`, fill: bgColor ?? `#${theme.colors.lt1 ?? "ffffff"}` };
    objects.push(frame);
    path.push(frame.id);

    const place = (r, extra) => ({ x: fx + r.x * k, y: fy + r.y * k, w: Math.max(2, r.w * k), h: Math.max(2, r.h * k), ...(r.rot ? { rot: r.rot } : {}), frame: frame.id, ...extra });

    // Gruppen: Kinder-Koordinaten in Folienkoordinaten umrechnen.
    function walk(tree, tf) {
      for (const el of tree.children) {
        const name = el.localName;
        if (name === "grpSp") {
          const x = readXfrm(kid(kid(el, "grpSpPr"), "xfrm"));
          const ch = kid(kid(el, "grpSpPr"), "xfrm");
          const chOff = kid(ch, "chOff");
          const chExt = kid(ch, "chExt");
          if (!x || !chExt) {
            walk(el, tf);
            continue;
          }
          const sx = x.w / Math.max(1, num(chExt.getAttribute("cx"), x.w));
          const sy = x.h / Math.max(1, num(chExt.getAttribute("cy"), x.h));
          const cox = num(chOff?.getAttribute("x"));
          const coy = num(chOff?.getAttribute("y"));
          walk(el, (r) => tf({ ...r, x: x.x + (r.x - cox) * sx, y: x.y + (r.y - coy) * sy, w: r.w * sx, h: r.h * sy }));
        } else if (name === "sp" || name === "cxnSp") {
          shape(el, tf, name === "cxnSp");
        } else if (name === "pic") {
          picture(el, tf);
        } else if (name === "graphicFrame") {
          table(el, tf);
        } else if (name === "AlternateContent") {
          const choice = kid(el, "Fallback") ?? kid(el, "Choice");
          if (choice) walk(choice, tf);
        }
      }
    }

    function shape(el, tf, connector) {
      const spPr = kid(el, "spPr");
      const ph = desc(kid(el, connector ? "nvCxnSpPr" : "nvSpPr"), "ph")[0];
      let x = readXfrm(kid(spPr, "xfrm"));
      if (!x && ph) x = readXfrm(placeholderXfrm(ph, layout, master));
      if (!x) return;
      const r = tf(x);
      const prst = kid(spPr, "prstGeom")?.getAttribute("prst");
      const lnColor = colorOf(kid(kid(spPr, "ln"), "solidFill"), theme);
      if (connector || ["line", "straightConnector1"].includes(prst)) {
        // Linie diagonal durch ihr Rechteck, als flaches gedrehtes Rechteck.
        const len = Math.hypot(r.w, r.h);
        let ang = (Math.atan2(r.h, r.w) * 180) / Math.PI;
        if (x.flipH !== x.flipV) ang = -ang;
        const thick = Math.max(num(kid(spPr, "ln")?.getAttribute("w"), 12700), 6000);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const color = lnColor ?? colorOf(desc(kid(el, "style"), "lnRef")[0], theme) ?? dark;
        objects.push(place({ x: cx - len / 2, y: cy - thick / 2, w: len, h: thick, rot: ang + r.rot }, { id: id("s"), type: "shape", shape: "line", fill: color }));
        return;
      }
      let fill = null;
      if (kid(spPr, "noFill")) fill = null;
      else if (kid(spPr, "solidFill")) fill = colorOf(kid(spPr, "solidFill"), theme);
      else if (!ph && prst && !kid(spPr, "noFill")) {
        const ref = desc(kid(el, "style"), "fillRef")[0];
        if (ref && ref.getAttribute("idx") !== "0") fill = colorOf(ref, theme);
      }
      if (kid(spPr, "gradFill")) fill = colorOf(desc(kid(spPr, "gradFill"), "gs")[0], theme);
      if (kid(spPr, "blipFill")) skipped.add("Bildfüllungen in Formen");
      const alpha = desc(kid(spPr, "solidFill"), "alpha")[0];
      const isTitle = ["title", "ctrTitle"].includes(ph?.getAttribute("type"));
      if (fill) {
        const ours = FROM_PRESET[prst] ?? (prst && prst !== "rect" ? (skipped.add(`Form „${prst}“ (als Rechteck)`), "rect") : "rect");
        objects.push(place(r, { id: id("s"), type: "shape", shape: ours, fill, ...(alpha ? { opacity: num(alpha.getAttribute("val")) / 100000 } : {}) }));
      }
      const styleColor = colorOf(desc(kid(el, "style"), "fontRef")[0], theme);
      const t = readText(kid(el, "txBody"), theme, {
        pt: isTitle ? 44 : ph ? 24 : 18,
        bold: false,
        color: styleColor ?? (fill ? "#ffffff" : dark),
        major: theme.major,
        minor: theme.minor,
      });
      if (t) {
        if (isTitle) frame.title = t.text.split("\n")[0].slice(0, 60);
        // Innenabstände des Textfelds (PowerPoint-Standard 0,1"/0,05") abziehen.
        const bodyPr = kid(kid(el, "txBody"), "bodyPr");
        const li = num(bodyPr?.getAttribute("lIns"), 91440);
        const ri = num(bodyPr?.getAttribute("rIns"), 91440);
        const ti = num(bodyPr?.getAttribute("tIns"), 45720);
        const bi = num(bodyPr?.getAttribute("bIns"), 45720);
        const inner = { ...r, x: r.x + li, y: r.y + ti, w: Math.max(r.w - li - ri, r.w * 0.5), h: Math.max(r.h - ti - bi, r.h * 0.5) };
        objects.push(
          place(inner, {
            fit: true,
            id: id("t"),
            type: "text",
            text: t.text,
            size: t.pt * EMU_PER_PT * k,
            color: t.color,
            align: t.align,
            role: isTitle ? "title" : ph?.getAttribute("type") === "subTitle" ? "subtitle" : "body",
            ...(t.bold ? { weight: 700 } : {}),
            ...(t.italic ? { italic: true } : {}),
            ...(t.font ? { font: t.font } : {}),
          }),
        );
      }
    }

    function picture(el, tf) {
      const x = readXfrm(kid(kid(el, "spPr"), "xfrm"));
      const embed = desc(el, "blip")[0]?.getAttributeNS(NS.r, "embed");
      const target = embed && rels.get(embed)?.target;
      const entry = target && files.get(target);
      if (!x || !entry?.data) return;
      const ext = target.split(".").pop().toLowerCase();
      if (!["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"].includes(ext)) {
        skipped.add(`Bilder im Format ${ext.toUpperCase()}`);
        return;
      }
      const o = place(tf(x), { id: id("i"), type: "image" });
      o.src = `media/${o.id}.${ext}`;
      media.push({ name: o.src, data: entry.data });
      objects.push(o);
    }

    function table(el, tf) {
      const x = readXfrm(kid(el, "xfrm"));
      const tbl = desc(el, "tbl")[0];
      if (!x) return;
      // SmartArt: PowerPoint legt eine fertig gezeichnete Fassung (diagrams/drawingN.xml) bei.
      // Deren Formen liegen relativ zum Rahmen des Grafikobjekts und lassen sich wie normale Formen lesen.
      const dm = desc(el, "relIds")[0]?.getAttributeNS(NS.r, "dm");
      if (!tbl && dm && rels.get(dm)) {
        const data = parseXml(files.get(rels.get(dm).target)?.text ?? "<x/>").documentElement;
        const drawingRel = desc(data, "dataModelExt")[0]?.getAttribute("relId");
        const drawingPart = drawingRel && rels.get(drawingRel)?.target;
        const drawing = drawingPart && files.get(drawingPart)?.text;
        if (drawing) {
          const dtree = desc(parseXml(drawing).documentElement, "spTree")[0];
          if (dtree) {
            walk(dtree, (r) => tf({ ...r, x: x.x + r.x, y: x.y + r.y }));
            return;
          }
        }
        skipped.add("SmartArt ohne gespeicherte Zeichnung (als Platzhalter)");
      }
      if (!tbl) {
        if (!dm) skipped.add("Diagramme aus PowerPoint (als Platzhalter)");
        objects.push(place(tf(x), { id: id("t"), type: "text", text: "[Diagramm aus PowerPoint]", size: 18 * EMU_PER_PT * k, color: dark, align: "center" }));
        return;
      }
      const colsW = desc(tbl, "gridCol").map((c) => num(c.getAttribute("w")));
      let ty = x.y;
      for (const tr of kids(tbl, "tr")) {
        const rh = num(tr.getAttribute("h"), 370840);
        let tx = x.x;
        kids(tr, "tc").forEach((tc, ci) => {
          const cw = colsW[ci] ?? 1000000;
          const tcPr = kid(tc, "tcPr");
          const fill = colorOf(kid(tcPr, "solidFill"), theme);
          const cell = tf({ x: tx, y: ty, w: cw, h: rh, rot: 0 });
          if (fill) objects.push(place(cell, { id: id("s"), type: "shape", shape: "rect", fill }));
          const t = readText(kid(tc, "txBody"), theme, { pt: 14, bold: false, color: dark, major: theme.major, minor: theme.minor });
          if (t) {
            const pad = cw * 0.05;
            objects.push(place({ ...cell, x: cell.x + pad, w: cell.w - 2 * pad }, { id: id("t"), type: "text", fit: true, text: t.text, size: t.pt * EMU_PER_PT * k, color: t.color, align: t.align, ...(t.bold ? { weight: 700 } : {}) }));
          }
          tx += cw;
        });
        ty += rh;
      }
    }

    const tree = desc(slide, "spTree")[0];
    if (tree) walk(tree, (r) => r);
  });

  // Überblick über alle Folien, als erster und letzter Pfadschritt.
  const rows = Math.ceil(slideParts.length / cols);
  const ow = cols * fw + (cols - 1) * gap;
  const oh = rows * fh + (rows - 1) * gap;
  const pad = fw * 0.1;
  const overview = { id: "f-overview", type: "frame", hidden: true, title: "Überblick", x: -pad, y: -pad, w: ow + 2 * pad, h: oh + 2 * pad };
  const ratio = sw / sh;
  return {
    doc: {
      format: "weitblick",
      version: 2,
      title,
      aspect: `${Math.round(ratio * 900)}:900`,
      theme: {
        ...baseTheme,
        id: "pptx",
        background: "#e9e9ec",
        text: dark,
        accent: theme.colors.accent1 ? `#${theme.colors.accent1}` : baseTheme.accent,
        accent2: theme.colors.accent2 ? `#${theme.colors.accent2}` : baseTheme.accent2,
        fonts: { title: theme.major ?? "sans", subtitle: theme.minor ?? "sans", body: theme.minor ?? "sans" },
      },
      fonts: [],
      objects: [overview, ...objects],
      path: ["f-overview", ...path, "f-overview"],
    },
    media,
    skipped: [...skipped],
    slides: slideParts.length,
  };
}
