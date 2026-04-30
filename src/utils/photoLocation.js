import exifr from "exifr";
import fetch from "node-fetch";

function toNumber(x) {
  const n = typeof x === "string" ? Number(x) : x;
  return Number.isFinite(n) ? n : null;
}

export function normalizeGoogleDriveUrl(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Already direct download style.
  // e.g. https://drive.google.com/uc?export=download&id=FILEID
  if (trimmed.includes("drive.google.com/uc?") && trimmed.includes("id=")) {
    return trimmed;
  }

  // e.g. https://drive.google.com/open?id=FILEID
  const openMatch = trimmed.match(/drive\.google\.com\/open\?id=([^&]+)/i);
  if (openMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
  }

  // e.g. https://drive.google.com/file/d/FILEID/view?usp=sharing
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (fileMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  }

  return trimmed;
}

export async function downloadImageToBuffer(imageRef) {
  if (typeof imageRef !== "string" || !imageRef.trim()) {
    throw new Error("Invalid image reference");
  }

  const ref = imageRef.trim();

  // data URL: data:image/jpeg;base64,....
  if (ref.startsWith("data:")) {
    const commaIdx = ref.indexOf(",");
    if (commaIdx === -1) throw new Error("Invalid data URL");
    const meta = ref.slice(0, commaIdx);
    const data = ref.slice(commaIdx + 1);
    const isBase64 = /;base64/i.test(meta);
    if (!isBase64) throw new Error("Only base64 data URLs supported");
    return Buffer.from(data, "base64");
  }

  const url = normalizeGoogleDriveUrl(ref);
  
  // Special handling for Google Drive URLs
  const isGoogleDrive = url.includes("drive.google.com");
  
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  };
  
  // Add referer for Google Drive to avoid access restrictions
  if (isGoogleDrive) {
    headers["Referer"] = "https://drive.google.com/";
    headers["Accept"] = "image/*,*/*;q=0.9";
  }

  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      timeout: 10000 // 10 second timeout
    });

    if (!resp.ok) {
      // For Google Drive, provide more specific error message
      if (isGoogleDrive) {
        if (resp.status === 403) {
          throw new Error(`Google Drive image access denied: The image may not be publicly accessible. Please make sure the image is shared with 'Anyone with the link' or upload from your device instead.`);
        } else if (resp.status === 404) {
          throw new Error(`Google Drive image not found: The image may have been deleted or the link is expired. Please select a different image.`);
        } else {
          throw new Error(`Google Drive image download failed: HTTP ${resp.status}. Please try uploading from your device instead.`);
        }
      }
      throw new Error(`Image download failed: HTTP ${resp.status}`);
    }

    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  } catch (error) {
    // Handle network errors and timeouts
    if (error.name === 'AbortError' || error.code === 'TIMEOUT') {
      throw new Error("Image download timed out. Please try again.");
    }
    throw error;
  }
}

export async function extractGpsFromImageBuffer(buf) {
  // exifr.gps returns { latitude, longitude, ... } or null
  const gps = await exifr.gps(buf);
  if (!gps) return null;
  const latitude = toNumber(gps.latitude);
  const longitude = toNumber(gps.longitude);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const a1 = toNumber(lat1);
  const o1 = toNumber(lon1);
  const a2 = toNumber(lat2);
  const o2 = toNumber(lon2);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;

  const R = 6371000; // meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const rLat1 = toRad(a1);
  const rLat2 = toRad(a2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(rLat1) * Math.cos(rLat2) * sinDLon * sinDLon;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}


