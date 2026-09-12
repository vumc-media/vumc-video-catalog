const PUBLIC_R2_BASE =
  "https://pub-b27dbb9301fa4d12b052a98a92aabbaf.r2.dev";

const COVER_FILENAMES = new Set([
  "poster.jpg",
  "poster.jpeg",
  "poster.png",
  "poster.webp",
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "cover.webp"
]);

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== "/videos.xml") {
      return new Response("Not Found", { status: 404 });
    }

    if (!env.MEDIA) {
      return new Response(
        "R2 binding MEDIA is not configured.",
        { status: 500 }
      );
    }

    try {
      const objects = await listAllObjects(env.MEDIA);
      const covers = buildCoverMap(objects);
      const thumbnails = buildThumbnailMap(objects);

      const sourceVideos = objects
        .filter((object) =>
          object.key.toLowerCase().endsWith(".mp4")
        )
        .map((object) =>
          makeVideo(object, covers, thumbnails)
        )
        .filter((video) => video !== null);

      const videos = addLatestStream(sourceVideos)
        .sort(sortVideos);

      return new Response(buildMRSS(videos), {
        headers: {
          "Content-Type":
            "application/rss+xml; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    } catch (error) {
      return new Response(
        "Catalog error: " + error.message,
        { status: 500 }
      );
    }
  }
};

async function listAllObjects(bucket) {
  const objects = [];
  let cursor;

  do {
    const options = {
      limit: 1000
    };

    if (cursor) {
      options.cursor = cursor;
    }

    const result = await bucket.list(options);

    objects.push(...result.objects);

    cursor = result.truncated
      ? result.cursor
      : undefined;
  } while (cursor);

  return objects;
}

function buildCoverMap(objects) {
  const covers = new Map();

  for (const object of objects) {
    const parts = object.key.split("/");
    const filename = parts.pop().toLowerCase();
    const folder = parts.join("/");

    if (
      folder &&
      COVER_FILENAMES.has(filename) &&
      !covers.has(folder)
    ) {
      covers.set(
        folder,
        PUBLIC_R2_BASE +
          "/" +
          encodeObjectKey(object.key)
      );
    }
  }

  return covers;
}

function buildThumbnailMap(objects) {
  const thumbnails = new Map();

  for (const object of objects) {
    const key = object.key;
    const lowerKey = key.toLowerCase();

    const extension = IMAGE_EXTENSIONS.find(
      (ext) => lowerKey.endsWith(ext)
    );

    if (!extension) {
      continue;
    }

    const parts = key.split("/");
    const filename = parts.pop();

    // poster.* and cover.* are reserved for folder artwork.
    if (COVER_FILENAMES.has(filename.toLowerCase())) {
      continue;
    }

    const matchKey = lowerKey.slice(
      0,
      -extension.length
    );

    if (!thumbnails.has(matchKey)) {
      thumbnails.set(
        matchKey,
        PUBLIC_R2_BASE +
          "/" +
          encodeObjectKey(key)
      );
    }
  }

  return thumbnails;
}

function makeVideo(object, covers, thumbnails) {
  const parts = object.key.split("/");
  const filename = parts.pop();
  const folder = parts.join("/");

  const videoMatchKey = object.key
    .toLowerCase()
    .replace(/\.mp4$/, "");

  const videoThumbnailUrl =
    thumbnails.get(videoMatchKey) || "";

  const rootFolder =
    parts.length > 0 ? parts[0] : "";

  const normalizedRoot =
    normalizeName(rootFolder);

  let section = "";
  let service = "";
  let series = "";
  let category = "";
  let description = "";
  let latestServiceRank = 0;

  if (
    normalizedRoot === "currentsermonseries" ||
    normalizedRoot === "currentseries"
  ) {
    service = displayServiceName(
      parts.length > 1 ? parts[1] : ""
    );

    if (service === "") {
      return null;
    }

    series =
      parts.length > 2
        ? parts.slice(2).join(" / ")
        : "Current Series";

    section = "Current Series";
    category = service;
    description = series;
    latestServiceRank = serviceRank(service);
  } else if (normalizedRoot === "library") {
    service = displayServiceName(
      parts.length > 1 ? parts[1] : ""
    );

    if (service === "") {
      service = "Worship";
    }

    series =
      parts.length > 2
        ? parts.slice(2).join(" / ")
        : service;

    section = "Library";
    category = series;
    description = service;
  } else {
    /*
     * Temporary backward compatibility:
     * videos in old top-level Traditional or
     * Contemporary folders will still be recognized
     * while the R2 folders are being reorganized.
     */
    const legacyServiceRank =
      serviceRank(rootFolder);

    if (legacyServiceRank === 0) {
      return null;
    }

    service = displayServiceName(rootFolder);

    series =
      parts.length > 1
        ? parts.slice(1).join(" / ")
        : "Current Series";

    section = "Current Series";
    category = service;
    description = series;
    latestServiceRank = legacyServiceRank;
  }

  return {
    key: object.key,
    section,
    series: category,
    description,
    service,
    latestServiceRank,
    title: cleanTitle(filename),

    coverUrl:
      videoThumbnailUrl ||
      (folder ? covers.get(folder) || "" : ""),

    seriesCoverUrl:
      findNearestCover(parts, covers),

    sectionCoverUrl:
      findNearestCover(parts.slice(0, 1), covers),

    uploaded: object.uploaded
      ? new Date(object.uploaded).getTime()
      : 0
  };
}

function addLatestStream(videos) {
  const catalog = videos.map(
    (video) => ({ ...video })
  );

  /*
   * Rank 1 = Traditional Worship
   * Rank 2 = Contemporary Worship
   *
   * Only videos under Current Sermon Series
   * receive a latestServiceRank. Library videos
   * therefore cannot appear under Latest Stream.
   */
  for (const serviceRankNumber of [1, 2]) {
    const serviceVideos = videos.filter(
      (video) =>
        video.latestServiceRank ===
        serviceRankNumber
    );

    if (serviceVideos.length === 0) {
      continue;
    }

    const latest = serviceVideos.reduce(
      (newest, video) => {
        if (!newest) {
          return video;
        }

        if (video.uploaded > newest.uploaded) {
          return video;
        }

        if (
          video.uploaded === newest.uploaded &&
          video.key > newest.key
        ) {
          return video;
        }

        return newest;
      },
      null
    );

    catalog.push({
      ...latest,
      section: "Latest Stream",
      series: "Latest Stream",
      description: latest.service,

      seriesCoverUrl:
        latest.coverUrl ||
        latest.seriesCoverUrl,

      sectionCoverUrl:
        latest.coverUrl ||
        latest.sectionCoverUrl,

      latestOrder: serviceRankNumber
    });
  }

  return catalog;
}

function cleanTitle(filename) {
  return filename
    .replace(/\.mp4$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sortVideos(a, b) {
  const sectionDifference =
    sectionRank(a.section) -
    sectionRank(b.section);

  if (sectionDifference !== 0) {
    return sectionDifference;
  }

  if (a.section !== b.section) {
    return a.section.localeCompare(b.section);
  }

  if (
    a.section === "Latest Stream" &&
    b.section === "Latest Stream"
  ) {
    return (
      (a.latestOrder || 99) -
      (b.latestOrder || 99)
    );
  }

  if (a.series !== b.series) {
    return a.series.localeCompare(b.series);
  }

  return a.title.localeCompare(
    b.title,
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}

function sectionRank(name) {
  const normalized = normalizeName(name);

  if (normalized === "lateststream") {
    return 0;
  }

  if (normalized === "currentseries") {
    return 1;
  }

  if (normalized === "library") {
    return 2;
  }

  return 10;
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function serviceRank(name) {
  const normalized = normalizeName(name);

  if (
    normalized.includes("tradit") ||
    normalized.includes("930")
  ) {
    return 1;
  }

  if (
    normalized.includes("contemp") ||
    normalized.includes("1030")
  ) {
    return 2;
  }

  return 0;
}

function displayServiceName(name) {
  const rank = serviceRank(name);

  if (rank === 1) {
    return "Traditional Worship";
  }

  if (rank === 2) {
    return "Contemporary Worship";
  }

  return String(name ?? "").trim();
}

function findNearestCover(folderParts, covers) {
  for (
    let length = folderParts.length;
    length > 0;
    length--
  ) {
    const folder = folderParts
      .slice(0, length)
      .join("/");

    const cover = covers.get(folder);

    if (cover) {
      return cover;
    }
  }

  return "";
}

function buildMRSS(videos) {
  const items = videos
    .map((video) => {
      const videoUrl =
        PUBLIC_R2_BASE +
        "/" +
        encodeObjectKey(video.key);

      const guid =
        "vumc-" +
        simpleSlug(video.key);

      const thumbnail = video.coverUrl
        ? `<media:thumbnail url="${xmlEscape(
            video.coverUrl
          )}" />`
        : "";

      const sectionThumbnail =
        video.sectionCoverUrl
          ? `<vumc:sectionThumbnail url="${xmlEscape(
              video.sectionCoverUrl
            )}" />`
          : "";

      const seriesThumbnail =
        video.seriesCoverUrl
          ? `<vumc:seriesThumbnail url="${xmlEscape(
              video.seriesCoverUrl
            )}" />`
          : "";

      return `
    <item>
      <title>${xmlEscape(video.title)}</title>
      <description>${xmlEscape(
        video.description || video.series
      )}</description>
      <category>${xmlEscape(
        video.series
      )}</category>
      <vumc:section>${xmlEscape(
        video.section
      )}</vumc:section>
      ${sectionThumbnail}
      ${seriesThumbnail}
      <guid isPermaLink="false">${xmlEscape(
        guid
      )}</guid>
      ${thumbnail}
      <media:content
        url="${xmlEscape(videoUrl)}"
        type="video/mp4"
      />
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss
  version="2.0"
  xmlns:media="http://search.yahoo.com/mrss/"
  xmlns:vumc="https://www.versaillesumc.org/roku"
>
  <channel>
    <title>Versailles UMC Video Library</title>
    <link>https://www.versaillesumc.org</link>
    <description>
      Worship services and sermon series from
      Versailles United Methodist Church.
    </description>
    <language>en-us</language>
${items}
  </channel>
</rss>`;
}

function encodeObjectKey(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function simpleSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
