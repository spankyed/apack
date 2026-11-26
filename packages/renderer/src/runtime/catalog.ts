// Declaration discovery is independent of executable frontend acceptance and settings authority.
import { createWindowPackCatalog, hostDeclaration } from '@apackdev/host/fe';
import { windowTransport } from '@/transport';

export const windowCatalog = createWindowPackCatalog({
  subscribe(receive, failed) {
    const subscription = windowTransport.controlSubscribe('packs.catalog', undefined, {
      onData: receive,
      onEnd: (error) => {
        if (error) failed(error);
      },
    });
    return () => subscription.unsubscribe();
  },
}, [hostDeclaration]);
