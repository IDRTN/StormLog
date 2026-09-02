package com.stormlog.scheduler

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StormLogSchedulerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StormLogScheduler")

    Function("start") { intervalMinutes: Int ->
      StormLogSchedulerService.start(requireNotNull(appContext.reactContext), intervalMinutes)
    }

    Function("stop") {
      StormLogSchedulerService.stop(requireNotNull(appContext.reactContext))
    }

    Function("isRunning") {
      StormLogSchedulerService.isRunning
    }
  }
}
