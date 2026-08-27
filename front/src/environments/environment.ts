export const environment = {
    serverURL: "/api",
    apiURL: "/api/",
    wsUrl: `${globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location.host}/ws`,
    nativeBackendOrigin: null,
    nativeBuildMode: 'web' as const,
};
