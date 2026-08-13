package com.iot.manager.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceProfileView;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceProfile;
import com.iot.manager.repository.DeviceProfileRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;

@Service
@RequiredArgsConstructor
public class DeviceProfileService {

    public static final String LEGACY_PROFILE_ID = "legacy-generic-v1";
    public static final int LEGACY_PROFILE_VERSION = 1;

    private final DeviceProfileRepository profileRepository;
    private final ObjectMapper objectMapper;

    @PostConstruct
    void synchronizeBundledProfiles() {
        try {
            Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath*:profiles/definitions/*.json");
            for (Resource resource : resources) {
                synchronize(readDefinition(resource));
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to load bundled device profiles", exception);
        }
    }

    @Transactional(readOnly = true)
    public List<DeviceProfileView> listEnabled() {
        return profileRepository.findByEnabledTrueOrderByProfileIdAscProfileVersionDesc().stream()
                .map(this::toView)
                .toList();
    }

    @Transactional(readOnly = true)
    public DeviceProfileView get(String profileId, Integer version) {
        return toView(require(profileId, version));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> capabilities(String profileId, Integer version) {
        Map<String, Object> definition = definition(require(profileId, version));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("controls", list(definition.get("controls")));
        result.put("commands", list(definition.get("commands")));
        result.put("telemetry", list(definition.get("telemetry")));
        return result;
    }

    @Transactional(readOnly = true, noRollbackFor = CommandValidationException.class)
    public ProfileCommandSpec validateCommand(Device device, DeviceCommandRequest request) {
        if (request == null) {
            throw new CommandValidationException(Map.of("request", "must not be null"));
        }
        if (request.type() == null || request.type().isBlank()) {
            throw new CommandValidationException(Map.of("type", "must not be blank"));
        }
        if (device == null) {
            throw new NoSuchElementException("Device not found");
        }

        String profileId = normalizeProfileId(device.getProfileId());
        int profileVersion = normalizeProfileVersion(device.getProfileVersion());
        Map<String, Object> definition = definition(require(profileId, profileVersion));
        String commandType = request.type().trim().toLowerCase(Locale.ROOT);
        Map<String, Object> command = findCommand(definition, commandType);
        Map<String, Object> parameters = request.parameters() == null ? Map.of() : request.parameters();
        validateParameters(map(command.get("parameters")), parameters);

        String stateField = text(command.get("stateField"));
        String stateParameter = text(command.get("stateParameter"));
        Object stateValue = stateField == null ? null : parameters.get(
                stateParameter == null ? stateField : stateParameter
        );
        return new ProfileCommandSpec(commandType, stateField, stateValue);
    }

    public String normalizeProfileId(String profileId) {
        return profileId == null || profileId.isBlank() ? LEGACY_PROFILE_ID : profileId;
    }

    public int normalizeProfileVersion(Integer profileVersion) {
        return profileVersion == null || profileVersion < 1 ? LEGACY_PROFILE_VERSION : profileVersion;
    }

    private void synchronize(Map<String, Object> definition) {
        String profileId = requiredText(definition, "profileId");
        int profileVersion = requiredPositiveInt(definition, "version");
        String displayName = requiredText(definition, "displayName");
        String deviceType = requiredText(definition, "deviceType");
        String canonical = writeJson(definition);
        String hash = sha256(canonical);
        LocalDateTime now = LocalDateTime.now();

        DeviceProfile profile = profileRepository.findByProfileIdAndProfileVersion(profileId, profileVersion)
                .orElseGet(() -> DeviceProfile.builder()
                        .profileId(profileId)
                        .profileVersion(profileVersion)
                        .createdAt(now)
                        .build());
        profile.setDisplayName(displayName);
        profile.setDeviceType(deviceType);
        profile.setDefinitionJson(canonical);
        profile.setDefinitionHash(hash);
        profile.setEnabled(true);
        profile.setUpdatedAt(now);
        profileRepository.save(profile);
    }

    private DeviceProfile require(String profileId, Integer version) {
        return profileRepository.findByProfileIdAndProfileVersion(
                        normalizeProfileId(profileId), normalizeProfileVersion(version))
                .filter(DeviceProfile::isEnabled)
                .orElseThrow(() -> new CommandValidationException(Map.of(
                        "profile", "Device profile " + normalizeProfileId(profileId) + " v"
                                + normalizeProfileVersion(version) + " is unavailable"
                )));
    }

    private DeviceProfileView toView(DeviceProfile profile) {
        return new DeviceProfileView(
                profile.getProfileId(),
                profile.getProfileVersion(),
                profile.getDisplayName(),
                profile.getDeviceType(),
                profile.isEnabled(),
                profile.getDefinitionHash(),
                definition(profile)
        );
    }

    private Map<String, Object> definition(DeviceProfile profile) {
        try {
            return objectMapper.readValue(profile.getDefinitionJson(), new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to read device profile " + profile.getProfileId(), exception);
        }
    }

    private Map<String, Object> readDefinition(Resource resource) {
        try {
            return objectMapper.readValue(resource.getInputStream(), new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to parse device profile " + resource.getFilename(), exception);
        }
    }

    private Map<String, Object> findCommand(Map<String, Object> definition, String type) {
        return list(definition.get("commands")).stream()
                .map(this::map)
                .filter(command -> type.equalsIgnoreCase(text(command.get("type"))))
                .findFirst()
                .orElseThrow(() -> new CommandValidationException(Map.of(
                        "type", "is not supported by profile " + text(definition.get("profileId"))
                )));
    }

    private void validateParameters(Map<String, Object> definitions, Map<String, Object> parameters) {
        Map<String, String> errors = new LinkedHashMap<>();
        definitions.forEach((name, rawDefinition) -> {
            Map<String, Object> parameter = map(rawDefinition);
            Object value = parameters.get(name);
            boolean required = Boolean.TRUE.equals(parameter.get("required"));
            if (value == null) {
                if (required) errors.put("parameters." + name, "is required");
                return;
            }

            String type = text(parameter.get("type"));
            if ("boolean".equals(type) && !(value instanceof Boolean)) {
                errors.put("parameters." + name, "must be a boolean");
            } else if ("number".equals(type) && !(value instanceof Number)) {
                errors.put("parameters." + name, "must be a number");
            } else if ("string".equals(type) && !(value instanceof String text) ||
                    "string".equals(type) && ((String) value).isBlank()) {
                errors.put("parameters." + name, "must be a nonblank string");
            }

            if (value instanceof Number number) {
                Number minimum = number(parameter.get("min"));
                Number maximum = number(parameter.get("max"));
                if (minimum != null && number.doubleValue() < minimum.doubleValue()) {
                    errors.put("parameters." + name, "must be at least " + minimum);
                }
                if (maximum != null && number.doubleValue() > maximum.doubleValue()) {
                    errors.put("parameters." + name, "must be at most " + maximum);
                }
            }
            if (value instanceof String string) {
                Number maxLength = number(parameter.get("maxLength"));
                if (maxLength != null && string.length() > maxLength.intValue()) {
                    errors.put("parameters." + name, "must contain at most " + maxLength.intValue() + " characters");
                }
                Collection<Object> options = list(parameter.get("options"));
                if (!options.isEmpty() && !options.contains(string)) {
                    errors.put("parameters." + name, "must be one of " + options);
                }
            }
        });
        if (!errors.isEmpty()) {
            throw new CommandValidationException(errors);
        }
    }

    private String requiredText(Map<String, Object> definition, String field) {
        String value = text(definition.get(field));
        if (value == null) throw new IllegalStateException("Bundled profile " + field + " must be present");
        return value;
    }

    private int requiredPositiveInt(Map<String, Object> definition, String field) {
        Number value = number(definition.get(field));
        if (value == null || value.intValue() < 1) throw new IllegalStateException("Bundled profile " + field + " must be positive");
        return value.intValue();
    }

    private String writeJson(Map<String, Object> definition) {
        try {
            return objectMapper.writeValueAsString(definition);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to serialize device profile", exception);
        }
    }

    private String sha256(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte valueByte : bytes) result.append(String.format("%02x", valueByte));
            return result.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        if (value instanceof Map<?, ?> source) {
            Map<String, Object> result = new LinkedHashMap<>();
            source.forEach((key, nested) -> result.put(String.valueOf(key), nested));
            return result;
        }
        return Map.of();
    }

    private List<Object> list(Object value) {
        if (value instanceof Collection<?> collection) return new ArrayList<>(collection);
        return List.of();
    }

    private String text(Object value) {
        if (value instanceof String string && !string.isBlank()) return string;
        return null;
    }

    private Number number(Object value) {
        return value instanceof Number number ? number : null;
    }
}
