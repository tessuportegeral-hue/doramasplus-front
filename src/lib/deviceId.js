const KEY = "dp_device_id";
const NAME_KEY = "dp_device_name";

export function getDeviceId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getDeviceName() {
  const cached = localStorage.getItem(NAME_KEY);
  if (cached) return cached;

  const ua = navigator.userAgent;
  let device = "Navegador";
  if (/iPhone|iPad/i.test(ua)) device = "iPhone/iPad";
  else if (/Android/i.test(ua)) device = "Android";
  else if (/SmartTV|TV/i.test(ua)) device = "Smart TV";
  else if (/Windows/i.test(ua)) device = "Windows";
  else if (/Macintosh|Mac OS/i.test(ua)) device = "Mac";
  else if (/Linux/i.test(ua)) device = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome/i.test(ua)) browser = "Chrome";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua)) browser = "Safari";

  const name = browser ? `${browser} no ${device}` : device;
  localStorage.setItem(NAME_KEY, name);
  return name;
}
