"""
tunisia.py — Offline reference data for Tunisian deliveries.

Gives SmartRoute approximate coordinates without any geocoding API:

    governorate / city name  →  (latitude, longitude)

Coordinates are city-centre approximations, good enough for routing
demos. If an Excel row has its own lat/lng, those are used instead.
"""

import difflib
import re
import unicodedata
from typing import Optional, Tuple

# The 24 governorates: canonical name → (lat, lng) of the main city.
GOVERNORATES = {
    "Tunis": (36.8065, 10.1815),
    "Ariana": (36.8625, 10.1956),
    "Ben Arous": (36.7531, 10.2189),
    "Manouba": (36.8081, 10.0972),
    "Nabeul": (36.4561, 10.7376),
    "Zaghouan": (36.4029, 10.1429),
    "Bizerte": (37.2744, 9.8739),
    "Beja": (36.7256, 9.1817),
    "Jendouba": (36.5011, 8.7802),
    "Le Kef": (36.1826, 8.7149),
    "Siliana": (36.0849, 9.3708),
    "Sousse": (35.8256, 10.6084),
    "Monastir": (35.7643, 10.8113),
    "Mahdia": (35.5047, 11.0622),
    "Sfax": (34.7406, 10.7603),
    "Kairouan": (35.6781, 10.0963),
    "Kasserine": (35.1676, 8.8365),
    "Sidi Bouzid": (35.0382, 9.4849),
    "Gabes": (33.8815, 10.0982),
    "Medenine": (33.3549, 10.5055),
    "Tataouine": (32.9297, 10.4518),
    "Gafsa": (34.4250, 8.7842),
    "Tozeur": (33.9197, 8.1335),
    "Kebili": (33.7044, 8.9690),
}

# Common alternative spellings people type in Excel → canonical name.
GOVERNORATE_ALIASES = {
    "ariana": "Ariana", "aryana": "Ariana", "ben arous": "Ben Arous",
    "benarous": "Ben Arous", "ben-arous": "Ben Arous", "mannouba": "Manouba",
    "la manouba": "Manouba", "nabel": "Nabeul", "bizerta": "Bizerte",
    "banzart": "Bizerte", "beja": "Beja", "jandouba": "Jendouba",
    "kef": "Le Kef", "el kef": "Le Kef", "soussa": "Sousse",
    "mahdiya": "Mahdia", "safaqis": "Sfax", "kairouane": "Kairouan",
    "qairouan": "Kairouan", "gabes": "Gabes", "qabis": "Gabes",
    "medenin": "Medenine", "mednine": "Medenine", "tatouine": "Tataouine",
    "kebeli": "Kebili", "touzeur": "Tozeur",
    # People often write the island instead of its governorate.
    "djerba": "Medenine", "jerba": "Medenine",
    # Arabic names
    "تونس": "Tunis", "اريانة": "Ariana", "أريانة": "Ariana",
    "بن عروس": "Ben Arous", "منوبة": "Manouba", "نابل": "Nabeul",
    "بنزرت": "Bizerte", "سوسة": "Sousse", "المنستير": "Monastir",
    "المهدية": "Mahdia", "صفاقس": "Sfax", "القيروان": "Kairouan",
    "قابس": "Gabes", "مدنين": "Medenine", "جربة": "Medenine",
}

# Well-known cities / neighbourhoods → (governorate, lat, lng).
CITIES = {
    # Tunis
    "Tunis Centre": ("Tunis", 36.7992, 10.1802),
    "Lac 1": ("Tunis", 36.8320, 10.2330),
    "Lac 2": ("Tunis", 36.8450, 10.2720),
    "El Menzah": ("Tunis", 36.8380, 10.1700),
    "La Marsa": ("Tunis", 36.8782, 10.3247),
    "Carthage": ("Tunis", 36.8528, 10.3233),
    "Le Bardo": ("Tunis", 36.8092, 10.1406),
    "El Omrane": ("Tunis", 36.8180, 10.1530),
    "Bab Saadoun": ("Tunis", 36.8060, 10.1640),
    # Ariana
    "Ariana Ville": ("Ariana", 36.8625, 10.1956),
    "Ennasr": ("Ariana", 36.8590, 10.1650),
    "La Soukra": ("Ariana", 36.8720, 10.2130),
    "Raoued": ("Ariana", 36.9400, 10.1800),
    "Mnihla": ("Ariana", 36.8500, 10.1100),
    # Ben Arous
    "Ben Arous Ville": ("Ben Arous", 36.7531, 10.2189),
    "El Mourouj": ("Ben Arous", 36.7350, 10.2100),
    "Megrine": ("Ben Arous", 36.7700, 10.2330),
    "Rades": ("Ben Arous", 36.7680, 10.2750),
    "Ezzahra": ("Ben Arous", 36.7440, 10.3080),
    "Hammam Lif": ("Ben Arous", 36.7300, 10.3400),
    # Manouba
    "Manouba Ville": ("Manouba", 36.8081, 10.0972),
    "Den Den": ("Manouba", 36.8070, 10.1100),
    "Douar Hicher": ("Manouba", 36.8270, 10.0880),
    # Sahel and others
    "Sousse Centre": ("Sousse", 35.8256, 10.6084),
    "Hammam Sousse": ("Sousse", 35.8600, 10.5950),
    "Sahloul": ("Sousse", 35.8400, 10.5900),
    "Monastir Centre": ("Monastir", 35.7643, 10.8113),
    "Skanes": ("Monastir", 35.7800, 10.7600),
    "Sfax Centre": ("Sfax", 34.7406, 10.7603),
    "Sakiet Ezzit": ("Sfax", 34.8000, 10.7600),
    "Nabeul Centre": ("Nabeul", 36.4561, 10.7376),
    "Hammamet": ("Nabeul", 36.4000, 10.6167),
    "Bizerte Centre": ("Bizerte", 37.2744, 9.8739),
    "Djerba Houmt Souk": ("Medenine", 33.8750, 10.8570),
    "Zarzis": ("Medenine", 33.5040, 11.1120),
    "Kairouan Centre": ("Kairouan", 35.6781, 10.0963),
    "Gabes Centre": ("Gabes", 33.8815, 10.0982),
}

CITY_ALIASES = {
    "djerba": "Djerba Houmt Souk", "jerba": "Djerba Houmt Souk",
    "houmt souk": "Djerba Houmt Souk", "marsa": "La Marsa",
    "bardo": "Le Bardo", "soukra": "La Soukra", "mourouj": "El Mourouj",
    "menzah": "El Menzah", "lac": "Lac 1", "les berges du lac": "Lac 1",
    "hammamet": "Hammamet", "ezzahra": "Ezzahra", "nasr": "Ennasr",
    "el nasr": "Ennasr",
}


def _key(text: str) -> str:
    """Lowercase, strip accents and extra spaces/dashes."""
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[-_.,]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


_GOV_LOOKUP = {_key(g): g for g in GOVERNORATES}
_GOV_LOOKUP.update({_key(a): g for a, g in GOVERNORATE_ALIASES.items()})
_CITY_LOOKUP = {_key(c): c for c in CITIES}
_CITY_LOOKUP.update({_key(a): c for a, c in CITY_ALIASES.items()})


def match_governorate(text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (canonical_name, suggestion).

    canonical_name is set when the text matches exactly (after
    normalisation) or via a known alias. Otherwise suggestion holds the
    closest governorate name, if any is reasonably close.
    """
    k = _key(text)
    if not k:
        return None, None
    if k in _GOV_LOOKUP:
        return _GOV_LOOKUP[k], None
    close = difflib.get_close_matches(k, list(_GOV_LOOKUP), n=1, cutoff=0.7)
    return None, (_GOV_LOOKUP[close[0]] if close else None)


def match_city(text: str) -> Optional[str]:
    k = _key(text)
    if not k:
        return None
    if k in _CITY_LOOKUP:
        return _CITY_LOOKUP[k]
    close = difflib.get_close_matches(k, list(_CITY_LOOKUP), n=1, cutoff=0.85)
    return _CITY_LOOKUP[close[0]] if close else None


def approximate_location(governorate: str, city: str = "") -> Tuple[float, float, str]:
    """
    Best offline guess for a delivery location.

    Returns (lat, lng, precision) where precision is "city" or
    "governorate". A city is used only if it belongs to the same
    governorate, so a typo in one column cannot send the driver
    to the wrong side of the country.
    """
    c = match_city(city) if city else None
    if c and CITIES[c][0] == governorate:
        _, lat, lng = CITIES[c]
        return lat, lng, "city"
    lat, lng = GOVERNORATES[governorate]
    return lat, lng, "governorate"
