# L1 Physics Laws — Pure graph mechanics, no LLM inside tick loop

from .law_01_energy_injection import (
    InjectionResult,
    TemporalTrigger,
    cleanup_refractory,
    inject_directory_ambient,
    inject_energy,
    process_temporal_triggers,
    reset_self_stimulus_state,
)

from .law_17_impulse import (
    ImpulseResult,
    accumulate_impulses,
    activate_desires,
    update_impulse,
)

from .law_18_relational_valence import (
    RelationalValenceResult,
    update_link_valence,
    update_relational_valence,
)
