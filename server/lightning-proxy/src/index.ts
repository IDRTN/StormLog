import { handleLightningProxy, type ProxyEnv } from './handler';

export default {
  fetch(request: Request, env: ProxyEnv): Promise<Response> {
    return handleLightningProxy(request, env);
  },
};
