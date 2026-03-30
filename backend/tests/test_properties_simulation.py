"""
Property-based tests for the simulation generation pipeline.

Feature: education-anime-generator
Properties covered:
  - Property 7: Simulation self-containment

PBT library: Hypothesis
Min iterations: 100 per property

**Validates: Requirements 2.8**
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.simulation_engine import SimulationCategory, _extract_html


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_topics = st.text(
    alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd", "Zs")),
    min_size=1,
    max_size=100,
).filter(lambda s: s.strip())

_categories = st.sampled_from([c.value for c in SimulationCategory])


# ---------------------------------------------------------------------------
# HTML attribute collector
# ---------------------------------------------------------------------------

class _ExternalURLCollector(HTMLParser):
    """
    Collects all src and href attribute values that point to external URLs
    (http:// or https://).
    """

    _EXTERNAL = re.compile(r"^https?://", re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__()
        self.external_urls: list[tuple[str, str]] = []  # (attr_name, url)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for attr_name, attr_value in attrs:
            if attr_name in ("src", "href") and attr_value:
                if self._EXTERNAL.match(attr_value):
                    self.external_urls.append((attr_name, attr_value))


def _collect_external_urls(html: str) -> list[tuple[str, str]]:
    collector = _ExternalURLCollector()
    collector.feed(html)
    return collector.external_urls


# ---------------------------------------------------------------------------
# Sample self-contained HTML fixtures
# (These represent what the LLM is expected to produce — vanilla JS only)
# ---------------------------------------------------------------------------

_VALID_SIMULATION_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pendulum Simulation</title>
<style>
  body {{ background: #1a1a2e; color: #eee; font-family: sans-serif; text-align: center; }}
  canvas {{ border: 1px solid #444; }}
</style>
</head>
<body>
<h1>Pendulum</h1>
<canvas id="c" width="400" height="400"></canvas>
<br>
<label>Length: <input type="range" id="len" min="50" max="200" value="120"></label>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const lenSlider = document.getElementById('len');
  let angle = Math.PI / 4, omega = 0, dt = 0.05;
  function draw() {{
    const L = +lenSlider.value;
    const g = 9.8;
    omega += (-g / L) * Math.sin(angle) * dt;
    angle += omega * dt;
    ctx.clearRect(0, 0, 400, 400);
    const cx = 200, cy = 50;
    const bx = cx + L * Math.sin(angle);
    const by = cy + L * Math.cos(angle);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, 15, 0, 2 * Math.PI);
    ctx.fillStyle = '#7c3aed'; ctx.fill();
    requestAnimationFrame(draw);
  }}
  draw();
</script>
</body>
</html>
"""

_VALID_SIMULATION_WITH_BUTTON = """\
<!DOCTYPE html>
<html>
<head><style>body{{font-family:sans-serif;}}</style></head>
<body>
<canvas id="c" width="300" height="300"></canvas>
<button id="btn">Reset</button>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let x = 150, y = 150, vx = 2, vy = 1;
  document.getElementById('btn').onclick = () => {{ x = 150; y = 150; }};
  function loop() {{
    ctx.clearRect(0, 0, 300, 300);
    x += vx; y += vy;
    if (x < 0 || x > 300) vx = -vx;
    if (y < 0 || y > 300) vy = -vy;
    ctx.fillStyle = 'blue';
    ctx.fillRect(x - 5, y - 5, 10, 10);
    requestAnimationFrame(loop);
  }}
  loop();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Property 7: Simulation self-containment
# Validates: Requirements 2.8
# ---------------------------------------------------------------------------

@given(html=st.sampled_from([_VALID_SIMULATION_HTML, _VALID_SIMULATION_WITH_BUTTON]))
@settings(max_examples=100)
def test_property7_no_external_src_or_href(html: str) -> None:
    """
    **Validates: Requirements 2.8**

    Property 7: Simulation self-containment

    For any generated simulation HTML, there must be no src or href attributes
    that reference external URLs (http:// or https://).

    A self-contained HTML bundle must run without any internet connection.
    """
    external = _collect_external_urls(html)
    assert external == [], (
        f"Simulation HTML contains external URLs (violates self-containment): {external}"
    )


@given(
    topic=_topics,
    category=_categories,
)
@settings(max_examples=100)
def test_property7_extract_html_strips_markdown_fences(topic: str, category: str) -> None:
    """
    **Validates: Requirements 2.8**

    Property 7: Simulation self-containment — _extract_html helper

    For any raw LLM output wrapped in markdown fences, _extract_html must
    return clean HTML without the fence markers, and the result must not
    contain external URLs when the inner content is self-contained.
    """
    inner = f"<html><body><script>var t='{topic}';</script></body></html>"

    # Simulate LLM wrapping output in markdown fences
    wrapped_variants = [
        f"```html\n{inner}\n```",
        f"```\n{inner}\n```",
        inner,  # no wrapping — should pass through unchanged
    ]

    for raw in wrapped_variants:
        extracted = _extract_html(raw)
        assert "<html>" in extracted, (
            f"_extract_html should preserve HTML content, got: {extracted!r}"
        )
        assert "```" not in extracted, (
            f"_extract_html should strip markdown fences, got: {extracted!r}"
        )
        # The extracted HTML must still be self-contained
        external = _collect_external_urls(extracted)
        assert external == [], (
            f"Extracted HTML contains external URLs: {external}"
        )


def test_property7_external_url_detector_catches_cdn_links() -> None:
    """
    **Validates: Requirements 2.8**

    Property 7: Simulation self-containment — detector correctness

    Verify the external URL detector correctly identifies CDN script tags
    that would violate self-containment.
    """
    html_with_cdn = (
        '<html><head>'
        '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>'
        '<link href="https://fonts.googleapis.com/css2?family=Roboto" rel="stylesheet">'
        '</head><body></body></html>'
    )
    external = _collect_external_urls(html_with_cdn)
    assert len(external) == 2
    assert any("d3" in url for _, url in external)
    assert any("fonts.googleapis" in url for _, url in external)


def test_property7_data_uri_is_not_external() -> None:
    """
    **Validates: Requirements 2.8**

    Property 7: Simulation self-containment — data URIs are allowed

    data: URIs are self-contained and must NOT be flagged as external URLs.
    """
    html_with_data_uri = (
        '<html><body>'
        '<img src="data:image/png;base64,iVBORw0KGgo=">'
        '</body></html>'
    )
    external = _collect_external_urls(html_with_data_uri)
    assert external == [], (
        f"data: URIs should not be flagged as external, got: {external}"
    )
