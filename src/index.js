const PUBLIC_R2_BASE =
  "https://pub-b27dbb9301fa4d12b052a98a92aabbaf.r2.dev";

const COVER_FILENAMES = new Set([
  "poster.jpg", "poster.jpeg", "poster.png",
  "cover.jpg", "cover.jpeg", "cover.png"
]);

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

      const videos = objects
        .filter((object) =>
          object.key.toLowerCase().endsWith(".mp4")
        )
        .map((object) => makeVideo(object, covers))
        .sort(sortVideos);

      return new Response(buildMRSS(videos), {
        headers: {
          "Content-Type": "application/rss+xml; charset=UTF-8",
          "Cache-Control": "public, max-age=60"
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
        PUBLIC_R2_BASE + "/" + encodeObjectKey(object.key)
      );
    }
  }

  return covers;
}

function makeVideo(object, covers) {
  const parts = object.key.split("/");
  const filename = parts.pop();
  const folder = parts.join("/");

  const sectionFolder =
    parts.length > 0
      ? parts[0]
      : "Worship";

  const seriesParts = parts.slice(1);

  return {
    key: object.key,
    section: sectionFolder,
    series:
      seriesParts.length > 0
        ? seriesParts.join(" / ")
        : sectionFolder,
    title: cleanTitle(filename),
    coverUrl:
      folder
        ? (covers.get(folder) || "")
        : "",
    sectionCoverUrl:
      covers.get(sectionFolder) || ""
  };
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
    sectionRank(a.section) - sectionRank(b.section);

  if (sectionDifference !== 0) {
    return sectionDifference;
  }

  if (a.section !== b.section) {
    return a.section.localeCompare(b.section);
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
  const normalized = name.toLowerCase();

  if (normalized.startsWith("traditional")) {
    return 1;
  }

  if (normalized.startsWith("contemporary")) {
    return 2;
  }

  if (normalized.startsWith("sermon")) {
    return 3;
  }

  return 10;
}

function buildMRSS(videos) {
  const items = videos.map((video) => {
    const videoUrl =
      PUBLIC_R2_BASE +
      "/" +
      encodeObjectKey(video.key);

    const guid =
      "vumc-" +
      simpleSlug(video.key);

    const thumbnail = video.coverUrl
      ? `<media:thumbnail url="${xmlEscape(video.coverUrl)}" />`
      : "";

    const sectionThumbnail = video.sectionCoverUrl
      ? `<vumc:sectionThumbnail url="${xmlEscape(video.sectionCoverUrl)}" />`
      : "";

    return `
    <item>
      <title>${xmlEscape(video.title)}</title>
      <description>${xmlEscape(video.series)}</description>
      <category>${xmlEscape(video.series)}</category>
      <vumc:section>${xmlEscape(video.section)}</vumc:section>
      ${sectionThumbnail}
      <guid isPermaLink="false">${xmlEscape(guid)}</guid>
      ${thumbnail}
      <media:content
        url="${xmlEscape(videoUrl)}"
        type="video/mp4"
      />
    </item>`;
  }).join("");

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
      Worship services and sermon series
      from Versailles United Methodist Church.
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
