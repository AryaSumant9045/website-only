import sys, os, time, hashlib, json, urllib.request, gzip, io
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
CACHE = "/tmp/cache"
def get(url, tries=5, wait=6, timeout=40):
    h = hashlib.md5(url.encode()).hexdigest()
    p = os.path.join(CACHE, h)
    if os.path.exists(p) and os.path.getsize(p) > 500:
        return open(p, encoding="utf-8", errors="replace").read()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                txt = data.decode("utf-8", errors="replace")
                if len(txt) > 500:
                    open(p, "w", encoding="utf-8").write(txt)
                    return txt
                last = f"short {len(txt)}"
        except Exception as e:
            last = str(e)
        time.sleep(wait * (i + 1))
    raise RuntimeError(f"FAIL {url} :: {last}")
if __name__ == "__main__":
    print(get(sys.argv[1])[:2000])
