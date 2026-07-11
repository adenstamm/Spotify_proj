import argparse
import json
from collections import Counter
from pathlib import Path


def find_duplicates(folder: Path) -> dict[tuple, int]:
    counter = Counter()

    for file in folder.rglob("*.json"):
        with file.open(encoding="utf-8") as stream:
            data = json.load(stream)

        for record in data:
            key = (
                record.get("ts"),
                record.get("master_metadata_track_name"),
                record.get("master_metadata_album_artist_name"),
                record.get("ms_played"),
            )
            if all(key):
                counter[key] += 1

    return {key: count for key, count in counter.items() if count > 1}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find duplicate records in a Spotify extended-history export."
    )
    parser.add_argument("folder", type=Path, help="Folder containing Spotify JSON files")
    args = parser.parse_args()

    folder = args.folder.expanduser()
    if not folder.is_dir():
        parser.error(f"not a directory: {folder}")

    print(find_duplicates(folder))


if __name__ == "__main__":
    main()
