package com.acme.core;

import org.apache.commons.lang3.StringUtils;

public class UserService {
    public String normalizeName(String raw) {
        return StringUtils.isBlank(raw) ? "anonymous" : raw.trim();
    }
}
