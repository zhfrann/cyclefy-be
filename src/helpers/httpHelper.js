export const getHost = (reqObject) => {
    return reqObject.get('host');
}

export const getProtocol = (reqObject) => {
    const host = reqObject.get('host');
    const isLocalhost = host.includes("localhost") || host.startsWith("127.0.0.1");
    return isLocalhost ? "http" : "https";
}