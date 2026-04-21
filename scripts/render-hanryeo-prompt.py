"""주어진 키워드로 hanryeo system+user 합친 프롬프트 텍스트 출력."""

import sys
import random
from pathlib import Path

TEXT_GEN_HUB = Path("/Users/ganggyunggyu/Programing/21lab/text-gen-hub")
sys.path.insert(0, str(TEXT_GEN_HUB))

from _prompts.hanryeo.system import get_hanryeo_system_prompt  # noqa: E402
from _prompts.hanryeo.user import get_hanryeo_user_prompt  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: render-hanryeo-prompt.py <keyword> [seed]")

    keyword = sys.argv[1]
    seed_value = sys.argv[2] if len(sys.argv) >= 3 else None
    rng = random.Random(seed_value) if seed_value else random.Random()

    system_prompt = get_hanryeo_system_prompt()
    user_prompt = get_hanryeo_user_prompt(keyword=keyword, rng=rng)

    combined = (
        system_prompt
        + "\n\n"
        + "━" * 30
        + "\n[사용자 요청]\n"
        + "━" * 30
        + "\n\n"
        + user_prompt
    )

    sys.stdout.write(combined)


if __name__ == "__main__":
    main()
