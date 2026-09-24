#!/usr/bin/env python3
"""Extract only regular release-bundle files from a digest-pinned OCI layer."""

import pathlib
import sys
import tarfile


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-release-evidence.py <archive.tar.gz> <destination>")
    archive = pathlib.Path(sys.argv[1])
    destination = pathlib.Path(sys.argv[2]).resolve(strict=True)
    with tarfile.open(archive, mode="r:gz") as bundle:
        members = bundle.getmembers()
        if not members:
            raise ValueError("Release evidence archive is empty")
        for member in members:
            raw_parts = member.name.split("/")
            path = pathlib.PurePosixPath(member.name)
            if (path.is_absolute() or ".." in raw_parts or not path.parts
                    or path.parts[0] != "release-bundle"
                    or not (member.isfile() or member.isdir())):
                raise ValueError(f"Unsafe release evidence member: {member.name}")
            target = destination.joinpath(*path.parts).resolve(strict=False)
            if not target.is_relative_to(destination):
                raise ValueError(f"Release evidence path escaped the destination: {member.name}")
        bundle.extractall(path=destination, members=members)


if __name__ == "__main__":
    main()
