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
        if (getActivity() == null) { call.reject("Activity is unavailable"); return; }
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
        if (getActivity() == null) { call.reject("Activity is unavailable"); return; }
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
            result.put("accepted", coordinator.prepareReveal(launchId, call.getString("activityInstanceId"), reducedMotion));
            call.resolve(result);
        });
    }

    private interface StartupAction { boolean run(StartupCoordinator coordinator); }

    private void update(PluginCall call, StartupAction action) {
        if (getActivity() == null) { call.reject("Activity is unavailable"); return; }
        getActivity().runOnUiThread(() -> {
            StartupCoordinator value = coordinator();
            if (value == null) { call.reject("Startup coordinator is unavailable"); return; }
            value.bindPlugin(this);
            JSObject result = new JSObject(); result.put("accepted", action.run(value)); call.resolve(result);
        });
    }

    @PluginMethod public void reportWebCoverReady(PluginCall call) {
        update(call, value -> value.reportWebCoverReady(call.getInt("launchId", -1), call.getString("activityInstanceId"), Boolean.TRUE.equals(call.getBoolean("reducedMotion", false))));
    }
    @PluginMethod public void setMotionPolicy(PluginCall call) {
        update(call, value -> value.setMotionPolicy(call.getInt("launchId", -1), call.getString("activityInstanceId"), Boolean.TRUE.equals(call.getBoolean("reducedMotion", false))));
    }
    @PluginMethod public void failStartup(PluginCall call) {
        update(call, value -> value.failStartup(call.getInt("launchId", -1), call.getString("activityInstanceId")));
    }

    void emitExitComplete(int launchId, String instanceId) {
        JSObject payload = new JSObject();
        payload.put("launchId", launchId);
        payload.put("activityInstanceId", instanceId);
        notifyListeners("exitComplete", payload);
    }
}
