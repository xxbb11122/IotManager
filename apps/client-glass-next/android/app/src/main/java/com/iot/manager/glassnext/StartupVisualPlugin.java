package com.iot.manager.glassnext;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "StartupVisual")
public class StartupVisualPlugin extends Plugin {
    private StartupCoordinator coordinator() {
        if (!(getActivity() instanceof MainActivity)) return null;
        return ((MainActivity) getActivity()).getStartupCoordinator();
    }

    @PluginMethod
    public void getLaunchState(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            StartupCoordinator coordinator = coordinator();
            if (coordinator == null) {
                call.reject("Startup coordinator is unavailable");
                return;
            }
            coordinator.bindPlugin(this);
            call.resolve(coordinator.launchState());
        });
    }

    @PluginMethod
    public void prepareReveal(PluginCall call) {
        Integer launchId = call.getInt("launchId");
        if (launchId == null) {
            call.reject("launchId is required");
            return;
        }
        boolean reducedMotion = Boolean.TRUE.equals(call.getBoolean("reducedMotion", false));
        getActivity().runOnUiThread(() -> {
            StartupCoordinator coordinator = coordinator();
            if (coordinator == null) {
                call.reject("Startup coordinator is unavailable");
                return;
            }
            coordinator.bindPlugin(this);
            JSObject result = new JSObject();
            result.put("accepted", coordinator.prepareReveal(launchId, reducedMotion));
            call.resolve(result);
        });
    }

    void emitExitComplete(int launchId) {
        JSObject payload = new JSObject();
        payload.put("launchId", launchId);
        notifyListeners("exitComplete", payload);
    }
}
