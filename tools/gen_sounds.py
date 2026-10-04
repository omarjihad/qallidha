#!/usr/bin/env python3
"""
يولّد حزمة الأصوات المدمجة (أصوات مركّبة سهلة التقليد بالفم).
التشغيل:  python3 tools/gen_sounds.py
الناتج:  public/sounds/*.mp3  +  src/builtin-sounds.js
"""
import json, os, subprocess, tempfile
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter

SR = 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "sounds")
rng = np.random.default_rng(7)


def t_of(d):
    return np.arange(int(d * SR)) / SR


def env_adsr(n, a=0.01, r=0.05, sustain=1.0):
    e = np.ones(n) * sustain
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, sustain, na)
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def osc(f, kind="sine", harmonics=24):
    """مذبذب بتردد متغيّر (مصفوفة) مع حماية من التشوّه."""
    f = np.asarray(f, dtype=np.float64)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == "sine":
        return np.sin(ph)
    out = np.zeros_like(ph)
    nyq = SR / 2
    for k in range(1, harmonics + 1):
        mask = (k * f) < nyq * 0.95
        if kind == "saw":
            out += mask * np.sin(k * ph) / k
        elif kind == "square" and k % 2 == 1:
            out += mask * np.sin(k * ph) / k
        elif kind == "brass":
            out += mask * np.sin(k * ph) / (k ** 1.15)
        elif kind == "flute":
            out += mask * np.sin(k * ph) * (1.0 if k == 1 else 0.18 / k)
    return out / np.max(np.abs(out) + 1e-9)


def lp(x, fc, order=2):
    b, a = butter(order, fc / (SR / 2), "low")
    return lfilter(b, a, x)


def bp(x, lo, hi, order=2):
    b, a = butter(order, [lo / (SR / 2), hi / (SR / 2)], "band")
    return lfilter(b, a, x)


def noise(n):
    return rng.standard_normal(n)


def resonator(x, fc_arr, bw):
    """مرشّح رنّان (formant) بتردد مركزي متغيّر مع الزمن."""
    y = np.zeros_like(x)
    y1 = y2 = 0.0
    fc_arr = np.broadcast_to(np.asarray(fc_arr, dtype=np.float64), x.shape)
    r = np.exp(-np.pi * bw / SR)
    for i in range(len(x)):
        th = 2 * np.pi * fc_arr[i] / SR
        a1 = 2 * r * np.cos(th)
        a2 = -r * r
        g = (1 - r) * np.sqrt(1 - 2 * r * np.cos(2 * th) + r * r)
        yi = g * x[i] + a1 * y1 + a2 * y2
        y[i] = yi
        y2, y1 = y1, yi
    return y


def voice(f0, formants, breath=0.06):
    """صوت بشري تقريبي: مصدر حنجري + ثلاث رنّانات."""
    f0 = np.asarray(f0, dtype=np.float64)
    src = osc(f0 * (1 + 0.004 * np.sin(2 * np.pi * 5.3 * np.arange(len(f0)) / SR)), "saw", 80)
    src = src + breath * noise(len(f0))
    out = np.zeros_like(src)
    for (fc, bw, g) in formants:
        out += g * resonator(src, fc, bw)
    return out


def interp(points, d):
    """منحنى من نقاط (زمن، قيمة)."""
    tt = t_of(d)
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return np.interp(tt, xs, ys)


def silence(d):
    return np.zeros(int(d * SR))


def cat(*parts):
    return np.concatenate(parts)


def fade(x, ms=6):
    n = int(ms * SR / 1000)
    x = x.copy()
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    return x


# ------------------------------------------------------------------ الأصوات

def s_ambulance():
    seg = []
    for i in range(6):
        f = 960 if i % 2 == 0 else 770
        n = int(0.42 * SR)
        x = osc(np.full(n, f), "square", 9) * env_adsr(n, 0.01, 0.02)
        seg.append(lp(x, 3500))
    return cat(*seg) * 0.8


def s_police():
    d = 2.8
    f = interp([(0, 620), (0.7, 1350), (1.4, 620), (2.1, 1350), (2.8, 640)], d)
    x = osc(f, "saw", 12)
    return lp(x, 2800) * env_adsr(len(f), 0.05, 0.12)


def s_slide_up():
    d = 1.3
    f = 380 * (1500 / 380) ** (t_of(d) / d)
    x = osc(f, "flute") + 0.04 * noise(len(f))
    return x * env_adsr(len(f), 0.03, 0.08)


def s_bomb():
    d = 1.7
    f = 1700 * (480 / 1700) ** (t_of(d) / d)
    w = osc(f, "flute") * env_adsr(len(f), 0.05, 0.03) * 0.8
    nb = int(0.7 * SR)
    boom = lp(noise(nb), 260, 3) * np.exp(-np.linspace(0, 7, nb)) * 3.5
    boom += 0.6 * np.sin(2 * np.pi * np.cumsum(np.linspace(90, 40, nb)) / SR) * np.exp(-np.linspace(0, 5, nb))
    return cat(w, boom)


def s_boing():
    d = 1.3
    tt = t_of(d)
    depth = 0.45 * np.exp(-tt * 2.6)
    f = 200 * (1 + depth * np.sin(2 * np.pi * 11 * tt)) * (1 + 0.25 * tt)
    x = osc(f, "saw", 18)
    x = lp(x, 1800)
    return x * np.exp(-tt * 1.6) * env_adsr(len(tt), 0.005, 0.1)


def note(freq, d, kind="piano"):
    n = int(d * SR)
    tt = np.arange(n) / SR
    if kind == "piano":
        x = sum(np.sin(2 * np.pi * freq * k * tt) * (0.6 ** (k - 1)) for k in range(1, 7))
        return x * np.exp(-tt * 3.2) * env_adsr(n, 0.004, 0.04)
    if kind == "brass":
        x = osc(np.full(n, freq), "brass", 20)
        return lp(x, 2600) * env_adsr(n, 0.03, 0.06)
    if kind == "flute":
        f = freq * (1 + 0.006 * np.sin(2 * np.pi * 5 * tt))
        return (osc(f, "flute") + 0.03 * noise(n)) * env_adsr(n, 0.04, 0.08)
    if kind == "beep":
        return np.sin(2 * np.pi * freq * tt) * env_adsr(n, 0.004, 0.01)
    raise ValueError(kind)


def s_doremi():
    fs = [523.25, 587.33, 659.25, 698.46, 783.99]
    return cat(*[note(f, 0.3, "piano") for f in fs], silence(0.2))


def s_fanfare():
    G4, C5 = 392.0, 523.25
    return cat(note(G4, 0.16, "brass"), silence(0.06), note(G4, 0.16, "brass"), silence(0.06),
               note(G4, 0.16, "brass"), silence(0.06), note(C5, 0.9, "brass"))


def s_phone():
    def ring(d):
        n = int(d * SR)
        tt = np.arange(n) / SR
        trill = (np.sin(2 * np.pi * 20 * tt) > 0).astype(float)
        x = 0.5 * np.sin(2 * np.pi * 440 * tt) + 0.5 * np.sin(2 * np.pi * 480 * tt)
        x = x * (0.55 + 0.45 * trill)
        return x * env_adsr(n, 0.01, 0.03)
    return cat(ring(0.9), silence(0.45), ring(0.9))


def s_laser():
    parts = []
    for i in range(3):
        d = 0.2
        f = 2200 * (280 / 2200) ** (t_of(d) / d)
        x = osc(f, "square", 7) * np.exp(-t_of(d) * 6)
        parts += [lp(x, 4000), silence(0.13)]
    return cat(*parts)


def s_owl():
    def hoo(d, f0=390):
        f = interp([(0, f0 * 0.92), (d * 0.3, f0), (d, f0 * 0.9)], d)
        x = osc(f, "flute") + 0.05 * lp(noise(len(f)), 1200)
        return x * env_adsr(len(f), 0.08, 0.15)
    return cat(hoo(0.55), silence(0.25), hoo(0.22, 410), silence(0.08), hoo(0.5, 380))


def s_cat():
    d = 1.0
    f0 = interp([(0, 520), (0.25, 760), (0.55, 700), (1.0, 430)], d)
    F1 = interp([(0, 330), (0.3, 820), (0.7, 700), (1.0, 380)], d)
    F2 = interp([(0, 2200), (0.3, 1350), (0.7, 1000), (1.0, 780)], d)
    x = voice(f0, [(F1, 90, 1.0), (F2, 130, 0.6), (3000, 250, 0.25)], breath=0.08)
    return x * env_adsr(len(f0), 0.05, 0.25)


def s_dog():
    def woof():
        d = 0.24
        f0 = interp([(0, 330), (0.06, 300), (0.24, 200)], d)
        F1 = interp([(0, 500), (0.08, 700), (0.24, 450)], d)
        x = voice(f0, [(F1, 120, 1.0), (1100, 160, 0.5), (2600, 300, 0.2)], breath=0.5)
        return x * env_adsr(len(f0), 0.01, 0.08)
    return cat(woof(), silence(0.22), woof(), silence(0.15))


def s_rooster():
    segs = [(0.22, 640, 680), (0.18, 760, 740), (0.22, 700, 720), (0.95, 920, 640)]
    out = []
    for d, a, b in segs:
        f0 = interp([(0, a), (d * 0.3, (a + b) / 2 + 40), (d, b)], d)
        F1 = np.full(len(f0), 750.0)
        x = voice(f0, [(F1, 110, 1.0), (1300, 150, 0.7), (2900, 280, 0.35)], breath=0.18)
        out += [x * env_adsr(len(f0), 0.015, 0.06), silence(0.03)]
    return cat(*out)


def s_cuckoo():
    E5, C5 = 659.25, 523.25
    k = lambda f: note(f, 0.3, "flute")
    return cat(k(E5), k(C5), silence(0.4), k(E5), k(C5))


def s_laugh():
    out = []
    # «مـوا»
    d = 0.42
    f0 = interp([(0, 160), (0.2, 230), (0.42, 210)], d)
    F1 = interp([(0, 300), (0.18, 800), (0.42, 780)], d)
    F2 = interp([(0, 900), (0.18, 1250), (0.42, 1200)], d)
    out += [voice(f0, [(F1, 100, 1.0), (F2, 140, 0.6), (2600, 260, 0.2)], 0.1) * env_adsr(len(f0), 0.03, 0.06), silence(0.08)]
    for p in [235, 215, 200, 185, 170]:
        d = 0.17
        f0 = np.full(int(d * SR), float(p))
        x = voice(f0, [(800, 110, 1.0), (1250, 150, 0.6), (2600, 260, 0.2)], 0.35)
        out += [x * env_adsr(len(f0), 0.01, 0.05), silence(0.1)]
    return cat(*out)


def s_alarm():
    beeps = []
    for g in range(2):
        for i in range(4):
            beeps += [note(1050, 0.11, "beep"), silence(0.07)]
        beeps.append(silence(0.28))
    return cat(*beeps)


def s_duck():
    def quack():
        d = 0.26
        f0 = interp([(0, 420), (0.1, 470), (0.26, 380)], d)
        x = voice(f0, [(1100, 150, 1.0), (1800, 200, 0.8), (3200, 300, 0.4)], breath=0.25)
        return x * env_adsr(len(f0), 0.01, 0.06)
    return cat(quack(), silence(0.16), quack(), silence(0.16), quack())


def s_horn():
    def beep(d):
        n = int(d * SR)
        tt = np.arange(n) / SR
        x = osc(np.full(n, 420.0), "saw", 25) + osc(np.full(n, 505.0), "saw", 25)
        return lp(x, 2400) * env_adsr(n, 0.01, 0.04)
    return cat(beep(0.18), silence(0.1), beep(0.7))


SOUNDS = [
    ("ambulance", "سيارة إسعاف", "🚑", "#ff5d5d", s_ambulance),
    ("police", "سيارة شرطة", "🚓", "#4d7cff", s_police),
    ("slide", "صفارة طالعة", "📈", "#2ec4b6", s_slide_up),
    ("bomb", "قنبلة نازلة", "💣", "#555b6e", s_bomb),
    ("boing", "بوينغ", "🌀", "#9b5de5", s_boing),
    ("doremi", "دو ري مي", "🎹", "#ffbe0b", s_doremi),
    ("fanfare", "تيرارا", "🎺", "#fb8500", s_fanfare),
    ("phone", "تلفون قديم", "☎️", "#e63946", s_phone),
    ("laser", "ليزر", "🔫", "#06d6a0", s_laser),
    ("owl", "بومة", "🦉", "#8d6e63", s_owl),
    ("cat", "بزونة", "🐱", "#f4a261", s_cat),
    ("dog", "جلب", "🐶", "#bc6c25", s_dog),
    ("rooster", "ديج", "🐓", "#d00000", s_rooster),
    ("cuckoo", "ساعة كوكو", "🕰️", "#588157", s_cuckoo),
    ("laugh", "ضحكة شريرة", "😈", "#7209b7", s_laugh),
    ("alarm", "منبّه", "⏰", "#ef476f", s_alarm),
    ("duck", "بطة", "🦆", "#00b4d8", s_duck),
    ("horn", "هورن سيارة", "🚗", "#f77f00", s_horn),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = []
    for sid, title, emoji, color, fn in SOUNDS:
        x = fn().astype(np.float64)
        x = x - np.mean(x)
        x = fade(x / (np.max(np.abs(x)) + 1e-9) * 0.89)
        x = cat(silence(0.04), x, silence(0.06))
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wavfile.write(tmp.name, SR, (x * 32767).astype(np.int16))
            dst = os.path.join(OUT, f"{sid}.mp3")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", str(SR),
                            "-c:a", "libmp3lame", "-b:a", "64k", dst], check=True)
            os.unlink(tmp.name)
        meta.append({"id": "b:" + sid, "title": title, "emoji": emoji, "color": color,
                     "url": f"/sounds/{sid}.mp3", "dur": round(len(x) / SR, 2)})
        print(f"{sid:10s} {len(x)/SR:5.2f}s  {os.path.getsize(dst)/1024:5.1f}KB  {title}")
    js = ("// يُولَّد تلقائيًا من tools/gen_sounds.py — لا تعدّله يدويًا.\n"
          "export const BUILTIN_SOUNDS = " + json.dumps(meta, ensure_ascii=False, indent=1) + ";\n")
    with open(os.path.join(ROOT, "src", "builtin-sounds.js"), "w", encoding="utf-8") as f:
        f.write(js)


if __name__ == "__main__":
    main()
