# Device profiles

Each JSON file in `definitions/` is a versioned source of truth for one device
class. The backend packages these definitions at build time, synchronizes them
to `device_profiles` on startup, and returns their capabilities in each device
view. The mobile client uses the same capability shape to decide which controls
to render.

## Adding a profile

1. Add a JSON definition under `profiles/definitions/` using
   `schema/device-profile.schema.json` as the structural guide.
2. Assign an immutable `profileId` and positive integer `version`.
3. Define each command's parameter types and bounds, plus `stateField` and
   `stateParameter` when the command changes a reported state value.
4. Add a compatible device adapter or Edge Agent driver before assigning the
   profile to a real device.
5. Build the backend and client, then add a command-validation test for the
   new profile.

Changing an existing version modifies every device that references it. Publish
a new version when a hardware protocol or command contract changes.
