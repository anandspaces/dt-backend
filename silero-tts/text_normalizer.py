"""
Production-grade text normalization for multilingual TTS.
Handles numbers, units, punctuation, and special cases.
"""

import re
from typing import Dict

from num2words import num2words


class TTSTextNormalizer:
    """Normalize text for TTS across multiple languages"""

    # Language-specific number conversion
    LANG_MAP = {
        "en": "en",
        "hi": "hi",
        "ta": "te",  # num2words uses 'te' for Tamil
        "te": "te",
        "bn": "bn",
        "gu": "gu",
        "kn": "kn",
        "ml": "ml",
        "mni": "en",  # Manipuri fallback to English
        "raj": "hi",  # Rajasthani fallback to Hindi
    }

    def __init__(self) -> None:
        self.patterns = self._compile_patterns()

    def _compile_patterns(self) -> Dict[str, re.Pattern[str]]:
        return {
            "decimal": re.compile(r"\b(\d+)\.(\d+)\b"),
            "percentage": re.compile(r"\b(\d+(?:\.\d+)?)\s*%"),
            "currency_rs": re.compile(r"₹\s*(\d+(?:,\d+)*(?:\.\d+)?)"),
            "currency_dollar": re.compile(r"\$\s*(\d+(?:,\d+)*(?:\.\d+)?)"),
            "time_colon": re.compile(r"\b(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?\b"),
            "time_hhmm": re.compile(r"\b(\d{1,2})(\d{2})\s*hrs?\b"),
            "date_slash": re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b"),
            "date_dash": re.compile(r"\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b"),
            "ordinal": re.compile(r"\b(\d+)(st|nd|rd|th)\b", re.IGNORECASE),
            "phone": re.compile(r"\b(\d{3})[-.]?(\d{3})[-.]?(\d{4})\b"),
            "range": re.compile(r"\b(\d+)\s*[-–—]\s*(\d+)\b"),
            "list_comma": re.compile(r"\b(\d+)\s*,\s*"),
            "int_comma": re.compile(r"\b(\d{1,3}(?:,\d{3})+)\b"),
            "integer": re.compile(r"\b(\d+)\b"),
            "units": re.compile(
                r"\b(\d+(?:\.\d+)?)\s*(kg|km|m|cm|mm|g|mg|l|ml|sec|min|hr|hrs)\b",
                re.IGNORECASE,
            ),
        }

    def normalize(self, text: str, language: str = "en") -> str:
        if not text.strip():
            return text
        lang = self.LANG_MAP.get(language, "en")
        text = self._normalize_percentages(text, lang)
        text = self._normalize_currency(text, lang)
        text = self._normalize_time(text, lang)
        text = self._normalize_dates(text, lang)
        text = self._normalize_ordinals(text, lang)
        text = self._normalize_phone(text, lang)
        text = self._normalize_ranges(text, lang)
        text = self._normalize_units(text, lang)
        text = self._normalize_lists(text, lang)
        text = self._normalize_decimals(text, lang)
        text = self._normalize_integers_with_commas(text, lang)
        text = self._normalize_integers(text, lang)
        text = self._normalize_punctuation(text)
        return text

    def _num_to_words(self, num: float, lang: str, ordinal: bool = False) -> str:
        try:
            if ordinal:
                return num2words(int(num), lang=lang, to="ordinal")
            return num2words(num, lang=lang)
        except (ValueError, NotImplementedError):
            try:
                if ordinal:
                    return num2words(int(num), lang="en", to="ordinal")
                return num2words(num, lang="en")
            except Exception:  # noqa: BLE001
                return str(num)

    def _normalize_percentages(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            num = float(m.group(1))
            words = self._num_to_words(num, lang)
            return f"{words} percent"

        return self.patterns["percentage"].sub(replace, text)

    def _normalize_currency(self, text: str, lang: str) -> str:
        def replace_rs(m: re.Match[str]) -> str:
            num_str = m.group(1).replace(",", "")
            num = float(num_str)
            words = self._num_to_words(num, lang)
            return f"{words} rupees"

        def replace_dollar(m: re.Match[str]) -> str:
            num_str = m.group(1).replace(",", "")
            num = float(num_str)
            words = self._num_to_words(num, lang)
            return f"{words} dollars"

        text = self.patterns["currency_rs"].sub(replace_rs, text)
        text = self.patterns["currency_dollar"].sub(replace_dollar, text)
        return text

    def _normalize_time(self, text: str, lang: str) -> str:
        def replace_colon(m: re.Match[str]) -> str:
            hour = int(m.group(1))
            minute = int(m.group(2))
            period = m.group(3) or ""
            hour_words = self._num_to_words(hour, lang)
            minute_words = self._num_to_words(minute, lang) if minute != 0 else "o'clock"
            if period:
                return f"{hour_words} {minute_words} {period.upper()}"
            return f"{hour_words} {minute_words}"

        def replace_hhmm(m: re.Match[str]) -> str:
            hour = int(m.group(1))
            minute = int(m.group(2))
            hour_words = self._num_to_words(hour, lang)
            minute_words = self._num_to_words(minute, lang)
            return f"{hour_words} {minute_words} hours"

        text = self.patterns["time_colon"].sub(replace_colon, text)
        text = self.patterns["time_hhmm"].sub(replace_hhmm, text)
        return text

    def _normalize_dates(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            day = int(m.group(1))
            month = int(m.group(2))
            year = m.group(3)
            day_words = self._num_to_words(day, lang, ordinal=True)
            months = [
                "january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december",
            ]
            month_name = months[month - 1] if 1 <= month <= 12 else str(month)
            year_int = int(year)
            if year_int < 100:
                year_int += 2000 if year_int < 50 else 1900
            if 1000 <= year_int <= 2999:
                first_two = year_int // 100
                last_two = year_int % 100
                if last_two == 0:
                    year_words = self._num_to_words(first_two, lang) + " hundred"
                else:
                    year_words = (
                        f"{self._num_to_words(first_two, lang)} {self._num_to_words(last_two, lang)}"
                    )
            else:
                year_words = self._num_to_words(year_int, lang)
            return f"{day_words} of {month_name} {year_words}"

        text = self.patterns["date_slash"].sub(replace, text)
        text = self.patterns["date_dash"].sub(replace, text)
        return text

    def _normalize_ordinals(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            num = int(m.group(1))
            return self._num_to_words(num, lang, ordinal=True)

        return self.patterns["ordinal"].sub(replace, text)

    def _normalize_phone(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            digits = m.group(1) + m.group(2) + m.group(3)
            return " ".join([self._num_to_words(int(d), lang) for d in digits])

        return self.patterns["phone"].sub(replace, text)

    def _normalize_ranges(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            start = int(m.group(1))
            end = int(m.group(2))
            start_words = self._num_to_words(start, lang)
            end_words = self._num_to_words(end, lang)
            return f"{start_words} to {end_words}"

        return self.patterns["range"].sub(replace, text)

    def _normalize_units(self, text: str, lang: str) -> str:
        unit_expansions = {
            "kg": "kilograms", "km": "kilometers", "m": "meters",
            "cm": "centimeters", "mm": "millimeters", "g": "grams", "mg": "milligrams",
            "l": "liters", "ml": "milliliters", "sec": "seconds", "min": "minutes",
            "hr": "hours", "hrs": "hours",
        }

        def replace(m: re.Match[str]) -> str:
            num = float(m.group(1))
            unit = m.group(2).lower()
            words = self._num_to_words(num, lang)
            unit_full = unit_expansions.get(unit, unit)
            return f"{words} {unit_full}"

        return self.patterns["units"].sub(replace, text)

    def _normalize_lists(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            num = int(m.group(1))
            words = self._num_to_words(num, lang)
            return f"{words}, "

        return self.patterns["list_comma"].sub(replace, text)

    def _normalize_decimals(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            integer_part = int(m.group(1))
            decimal_part = m.group(2)
            int_words = self._num_to_words(integer_part, lang)
            dec_words = " ".join([self._num_to_words(int(d), lang) for d in decimal_part])
            return f"{int_words} point {dec_words}"

        return self.patterns["decimal"].sub(replace, text)

    def _normalize_integers_with_commas(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            num_str = m.group(1).replace(",", "")
            num = int(num_str)
            return self._num_to_words(num, lang)

        return self.patterns["int_comma"].sub(replace, text)

    def _normalize_integers(self, text: str, lang: str) -> str:
        def replace(m: re.Match[str]) -> str:
            num = int(m.group(1))
            return self._num_to_words(num, lang)

        return self.patterns["integer"].sub(replace, text)

    def _normalize_punctuation(self, text: str) -> str:
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"([.!?])\s*", r"\1 ", text)
        text = re.sub(r"\s*,\s*", ", ", text)
        return text.strip()
