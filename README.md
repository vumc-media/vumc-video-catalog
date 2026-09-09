# VUMC Video Catalog

Cloudflare Worker that automatically generates the Versailles UMC Roku video catalog from MP4 files stored in the `vumc-media` R2 bucket.

## R2 organization

Create a top-level folder for each sermon series and place MP4 files inside it.

Example:

    Acts The Church That Changed the World/
      Week 1.mp4
      Week 2.mp4

The folder name becomes the series/category and the MP4 filename becomes the episode title.

## Catalog endpoint

After deployment, the generated MRSS catalog is available at:

    /videos.xml

The root `/` returns the same catalog for convenient testing.
